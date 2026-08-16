#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

from common import canonicalize, clean_description, clean_text, load_snapshot, load_source_health, make_report, merge_report, normalize_date, reports_by_url, update_source_health, utc_now, write_snapshot, write_source_health

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "sources.json"
READER_PREFIX = "https://r.jina.ai/"
TIMEOUT = 60
LINK_RE = re.compile(r"\[([^\]\n]{4,300})\]\(([^)\s]+)\)")
GENERIC = {"read more", "learn more", "explore", "more", "home", "contact", "download", "see all", "view all"}

MCKINSEY_BOOTSTRAP = [
    {"title":"Semiconductors: Etching the new map of strategic supply","date":"2026-06-30","url":"https://www.mckinsey.com/mgi/our-research/semiconductors-etching-the-new-map-of-strategic-supply","description":"As geopolitics shift, more countries are wooing semiconductor manufacturers to enhance resilience while demand for advanced semiconductors continues to grow."},
    {"title":"Frontiers of compute: The technologies to reduce AI inference costs","date":"2026-06-25","url":"https://www.mckinsey.com/industries/semiconductors/our-insights/frontiers-of-compute-the-technologies-to-reduce-ai-inference-costs","description":"AI infrastructure investment is creating sustained demand across the semiconductor value chain as compute becomes a strategic asset."},
    {"title":"The next era of semiconductor value creation","date":"2026-03-30","url":"https://www.mckinsey.com/industries/semiconductors/our-insights/the-next-era-of-semiconductor-value-creation","description":"The AI boom and data center buildout are driving semiconductor demand and changing the industry value-creation agenda."},
    {"title":"Hiding in plain sight: The underestimated size of the semiconductor industry","date":"2026-01-15","url":"https://www.mckinsey.com/industries/semiconductors/our-insights/hiding-in-plain-sight-the-underestimated-size-of-the-semiconductor-industry","description":"McKinsey analysis examines semiconductor market growth, segment economics, and demand driven by AI and data centers."}
]

def same_host(a: str, b: str) -> bool:
    return urlparse(a).netloc.lower().removeprefix("www.") == urlparse(b).netloc.lower().removeprefix("www.")

def allowed(url: str, source: dict) -> bool:
    if not same_host(url, source["url"]): return False
    path = urlparse(url).path.lower()
    return any(path.startswith(prefix.lower()) for prefix in source.get("allowed_path_prefixes") or [])

def reader_fetch(url: str) -> str:
    response = requests.get(READER_PREFIX + url, timeout=TIMEOUT, headers={"User-Agent":"ConsultantSystemBot/2.0 (+https://github.com/linwuyen/Consultant_System)","Accept":"text/plain","X-Timeout":"45"})
    response.raise_for_status()
    return response.text if len(response.text) >= 100 else ""

def _nearest_date(text: str, start: int, end: int) -> str:
    before = text[max(0,start-450):start]; after = text[end:min(len(text),end+450)]
    for window in (after,before):
        value = normalize_date(window)
        if value: return value
    return ""

def _bounded_card_text(text: str, matches: list[re.Match[str]], index: int) -> str:
    current = matches[index]; next_start = matches[index+1].start() if index+1 < len(matches) else len(text)
    return text[current.end():min(next_start,current.end()+900)]

def _reader_url(raw: str, source_url: str) -> str:
    raw = raw.strip().strip('<>')
    if raw.startswith(("#", "mailto:", "javascript:", "data:")):
        return ""
    base = source_url if source_url.endswith("/") else source_url + "/"
    return canonicalize(urljoin(base, raw))

def extract_markdown(text: str, source: dict, topic_keywords: dict[str,list[str]], now: str) -> list[dict]:
    matches = list(LINK_RE.finditer(text)); out: dict[str,dict] = {}
    for index, match in enumerate(matches):
        title = clean_text(re.sub(r"[*_#`]+"," ",match.group(1)),300); url = _reader_url(match.group(2), source["url"])
        if len(title) < 14 or title.lower() in GENERIC or not url or not allowed(url,source): continue
        published_at = _nearest_date(text,match.start(),match.end())
        if not published_at: continue
        description = clean_description(_bounded_card_text(text,matches,index), title=title)
        item = make_report(company=source["company"],source_name=source["name"],url=url,title=title,published_at=published_at,description=description,topic_keywords=topic_keywords,now=now,published_at_source="reader-near-link",description_source="reader-card" if description else "",observation_mode="reader-fallback")
        out[url] = item
    return list(out.values())

def bootstrap_mckinsey(topic_keywords: dict[str,list[str]], now: str) -> list[dict]:
    return [make_report(company="McKinsey",source_name="McKinsey official verified bootstrap",url=row["url"],title=row["title"],published_at=row["date"],description=row["description"],topic_keywords=topic_keywords,now=now,published_at_source="verified-bootstrap",description_source="verified-bootstrap",observation_mode="bootstrap") for row in MCKINSEY_BOOTSTRAP]

def main() -> int:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")); topic_keywords = config.get("topic_keywords") or {}; max_empty = int((config.get("health_policy") or {}).get("max_consecutive_empty_runs",3)); now = utc_now()
    payload = load_snapshot(); reports = reports_by_url(payload); health = load_source_health(); content_changed = False; live_observed: dict[str,int] = {}
    for source in config.get("fallback_sources") or []:
        items: list[dict] = []; transport_ok = False; error = ""
        try:
            text = reader_fetch(source["url"]); items = extract_markdown(text,source,topic_keywords,now); transport_ok = True
            print(f"READER {source['company']} {source['name']}: {len(items)} dated official links")
        except Exception as exc:
            error = f"{type(exc).__name__}:{exc}"; print(f"WARN reader fallback failed {source['url']}: {error}",file=sys.stderr)
        live_observed[source["company"]] = live_observed.get(source["company"],0) + len(items)
        for item in items:
            merged, changed = merge_report(reports.get(item["url"]),item,now); reports[item["url"]] = merged; content_changed = content_changed or changed
        update_source_health(health,company=source["company"],name=source["name"],url=source["url"],transport="reader",attempted_at=now,transport_ok=transport_ok,observed_count=len(items),error=error,max_consecutive_empty_runs=max_empty)
    if not any(row.get("company") == "McKinsey" for row in reports.values()):
        seeds = bootstrap_mckinsey(topic_keywords,now); print(f"BOOTSTRAP McKinsey: {len(seeds)} verified official records")
        for item in seeds:
            merged, changed = merge_report(reports.get(item["url"]),item,now); reports[item["url"]] = merged; content_changed = content_changed or changed
    payload["reports"] = list(reports.values()); write_snapshot(payload,content_changed=content_changed,now=now); write_source_health(health)
    counts = {company:sum(1 for row in reports.values() if row.get("company") == company) for company in ("McKinsey","BCG","Deloitte","PwC")}
    print("FALLBACK COVERAGE",counts,"live_observed",live_observed,"content_changed",content_changed)
    return 0

if __name__ == "__main__": raise SystemExit(main())
