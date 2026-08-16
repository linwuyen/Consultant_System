#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from common import (
    canonicalize, clean_description, clean_text, load_snapshot, load_source_health, make_report,
    merge_report, normalize_date, reports_by_url, update_source_health, utc_now, write_snapshot,
    write_source_health,
)

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "sources.json"
HTTP_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0 Safari/537.36"
)
ROBOTS_USER_AGENT = "ConsultantSystemBot"
MAX_LINKS_PER_SOURCE = 60
MAX_LISTING_REPORTS = 30
REQUEST_DELAY_SECONDS = 0.20
TIMEOUT = 18
EXCLUDE_PARTS = (
    "/careers", "/about/people", "/contact", "/locations", "/people/", "/alumni",
    "/privacy", "/terms", "/cookies", "/events", "/search", "/login",
    "/subscribe", "/newsletter", "/sitemap", "/userprofile", "/subscription",
)
GENERIC_LINK_TEXT = {"", "learn more", "read more", "view more", "visit page", "see all", "more", "menu", "explore", "view all", "download", "home"}


@dataclass
class Source:
    company: str
    name: str
    url: str
    allowed_path_prefixes: list[str]
    listing_only: bool = False


def make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=2, connect=2, read=1, status=2, backoff_factor=0.5,
                  status_forcelist=(429, 500, 502, 503, 504), allowed_methods=frozenset(["GET", "HEAD"]),
                  respect_retry_after_header=True)
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({
        "User-Agent": HTTP_USER_AGENT, "Accept-Language": "en-US,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "X-Research-Indexer": "Consultant_System metadata-only research index",
    })
    return session


def robots_allowed(session: requests.Session, url: str, cache: dict[str, RobotFileParser | None]) -> bool | None:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in cache:
        robots_url = f"{origin}/robots.txt"
        try:
            response = session.get(robots_url, timeout=TIMEOUT)
            if not response.ok:
                cache[origin] = None
            else:
                parser = RobotFileParser(); parser.set_url(robots_url); parser.parse(response.text.splitlines())
                cache[origin] = parser
        except requests.RequestException:
            cache[origin] = None
    parser = cache[origin]
    return None if parser is None else parser.can_fetch(ROBOTS_USER_AGENT, url)


def fetch_html(session: requests.Session, url: str, robots_cache: dict[str, RobotFileParser | None]) -> tuple[str | None, str]:
    decision = robots_allowed(session, url, robots_cache)
    if decision is False:
        return None, "robots_denied"
    if decision is None:
        return None, "robots_unknown"
    try:
        response = session.get(url, timeout=TIMEOUT); response.raise_for_status()
        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
            return None, f"unsupported_content_type:{content_type}"
        time.sleep(REQUEST_DELAY_SECONDS)
        return response.text, ""
    except requests.RequestException as exc:
        return None, f"{type(exc).__name__}:{exc}"


def same_host(a: str, b: str) -> bool:
    return urlparse(a).netloc.lower().removeprefix("www.") == urlparse(b).netloc.lower().removeprefix("www.")


def looks_like_report(url: str, source: Source) -> bool:
    path = urlparse(url).path.lower()
    if not same_host(url, source.url) or any(part in path for part in EXCLUDE_PARTS):
        return False
    if source.allowed_path_prefixes and not any(path.startswith(prefix.lower()) for prefix in source.allowed_path_prefixes):
        return False
    if path in ("", "/") or path.endswith((".jpg", ".jpeg", ".png", ".gif", ".svg", ".zip", ".mp4", ".pdf")):
        return False
    return len(path.strip("/").split("/")) >= 2


def anchor_context(anchor: Any) -> str:
    node: Any = anchor
    fallback = clean_text(anchor.get_text(" ", strip=True), 500)
    for _ in range(6):
        node = getattr(node, "parent", None)
        if node is None:
            break
        text = clean_text(node.get_text(" ", strip=True), 1800)
        if not text:
            continue
        if len(text) <= 1200:
            fallback = text
        if normalize_date(text):
            return text
        if len(text) > 1500:
            break
    return fallback


def candidate_score(anchor: Any, url: str) -> int:
    path = urlparse(url).path.lower(); label = clean_text(anchor.get_text(" ", strip=True), 300); context = anchor_context(anchor)
    score = 20 if normalize_date(context) else 0
    if re.search(r"/20\d{2}/", path): score += 12
    for marker, weight in (("/our-insights/",10),("/publications/",9),("/research-insights/",9),("/the-leadership-agenda/",8),("/mgi/our-research/",8),("/insights/",5),("/issues/",4)):
        if marker in path: score += weight
    if len(label) >= 24: score += 4
    if label.lower() in GENERIC_LINK_TEXT: score -= 10
    return score


def discover_links(html: str, source: Source) -> list[str]:
    soup = BeautifulSoup(html, "html.parser"); scope = soup.find("main") or soup
    candidates: dict[str, tuple[int, int]] = {}
    for order, anchor in enumerate(scope.find_all("a", href=True)):
        if anchor.find_parent(["nav", "header", "footer"]): continue
        raw = str(anchor.get("href", "")).strip()
        if not raw or raw.startswith(("#", "mailto:", "javascript:")): continue
        url = canonicalize(urljoin(source.url, raw))
        if not looks_like_report(url, source): continue
        scored = (candidate_score(anchor, url), -order)
        if url not in candidates or scored > candidates[url]: candidates[url] = scored
    return sorted(candidates, key=lambda u: candidates[u], reverse=True)[:MAX_LINKS_PER_SOURCE]


def jsonld_objects(soup: BeautifulSoup) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for script in soup.find_all("script", type="application/ld+json"):
        try: data = json.loads(script.string or script.get_text() or "{}")
        except (json.JSONDecodeError, TypeError): continue
        stack = data if isinstance(data, list) else [data]
        for item in stack:
            if isinstance(item, dict) and isinstance(item.get("@graph"), list): stack.extend(item["@graph"])
            if isinstance(item, dict): out.append(item)
    return out


def meta_content(soup: BeautifulSoup, *selectors: tuple[str, str]) -> str:
    for attr, value in selectors:
        tag = soup.find("meta", attrs={attr: value})
        if tag and tag.get("content"): return clean_text(str(tag["content"]))
    return ""


def clean_title(title: str, company: str) -> str:
    title = clean_text(title, 300)
    for suffix in (f" | {company}", f" - {company}", " | McKinsey & Company", " | BCG", " | Deloitte", " | PwC"):
        if title.endswith(suffix): title = title[:-len(suffix)].strip()
    return title[:300]


def extract_published_at(soup: BeautifulSoup) -> tuple[str, str]:
    for tag in soup.find_all("time"):
        value = normalize_date(str(tag.get("datetime") or tag.get_text(" ", strip=True)))
        if value: return value, "time"
    for obj in jsonld_objects(soup):
        value = normalize_date(str(obj.get("datePublished") or ""))
        if value: return value, "jsonld:datePublished"
    raw = meta_content(soup, ("property","article:published_time"), ("name","publish-date"), ("name","publication_date"), ("name","date"))
    value = normalize_date(raw)
    if value: return value, "meta"
    h1 = soup.find("h1")
    if h1:
        parts: list[str] = []; chars = 0
        for node in h1.find_all_next(string=True):
            parent_name = getattr(getattr(node, "parent", None), "name", "")
            if parent_name in {"script", "style", "noscript"}: continue
            text = clean_text(str(node), 500)
            if not text: continue
            parts.append(text); chars += len(text)
            if chars >= 1200: break
        value = normalize_date(" ".join(parts))
        if value: return value, "visible-near-h1"
    return "", ""


def extract_listing_reports(html: str, source: Source, topic_keywords: dict[str, list[str]], now: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser"); scope = soup.find("main") or soup; by_url: dict[str, tuple[int, dict[str, Any]]] = {}
    for order, anchor in enumerate(scope.find_all("a", href=True)):
        if anchor.find_parent(["nav", "header", "footer"]): continue
        raw = str(anchor.get("href", "")).strip()
        if not raw or raw.startswith(("#", "mailto:", "javascript:")): continue
        url = canonicalize(urljoin(source.url, raw))
        if not looks_like_report(url, source) or url == canonicalize(source.url): continue
        title = clean_title(anchor.get_text(" ", strip=True), source.company)
        if len(title) < 16 or title.lower() in GENERIC_LINK_TEXT: continue
        context = anchor_context(anchor); published_at = normalize_date(context)
        if not published_at: continue
        description = clean_description(context, title=title)
        item = make_report(company=source.company, source_name=source.name, url=url, title=title, published_at=published_at,
                           description=description, topic_keywords=topic_keywords, now=now, published_at_source="listing-card",
                           description_source="listing-card" if description else "", observation_mode="direct-listing")
        score = candidate_score(anchor, url) * 1000 - order
        if url not in by_url or score > by_url[url][0]: by_url[url] = (score, item)
    return [item for _, item in sorted(by_url.values(), key=lambda x: x[0], reverse=True)][:MAX_LISTING_REPORTS]


def extract_report(html: str, url: str, source: Source, topic_keywords: dict[str, list[str]], now: str) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "html.parser")
    title = meta_content(soup, ("property","og:title"), ("name","twitter:title"))
    if not title:
        h1 = soup.find("h1"); title = h1.get_text(" ", strip=True) if h1 else ""
    if not title and soup.title: title = soup.title.get_text(" ", strip=True)
    title = clean_title(title, source.company)
    if len(title) < 5: return None
    published_at, date_source = extract_published_at(soup)
    if not published_at: return None
    description = meta_content(soup, ("property","og:description"), ("name","description"), ("name","twitter:description")); description_source = "meta" if description else ""
    if not description:
        for obj in jsonld_objects(soup):
            if obj.get("description"):
                description = clean_text(str(obj["description"]), 700); description_source = "jsonld:description"; break
    return make_report(company=source.company, source_name=source.name, url=url, title=title, published_at=published_at,
                       description=description, topic_keywords=topic_keywords, now=now, published_at_source=date_source,
                       description_source=description_source, observation_mode="direct-article")


def main() -> int:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")); sources = [Source(**row) for row in config.get("sources", [])]
    topic_keywords = config.get("topic_keywords", {}); max_empty = int((config.get("health_policy") or {}).get("max_consecutive_empty_runs", 3)); now = utc_now()
    session = make_session(); robots_cache: dict[str, RobotFileParser | None] = {}
    payload = load_snapshot(); reports = reports_by_url(payload); health = load_source_health(); content_changed = False; attempted = 0
    for source in sources:
        attempted += 1; print(f"SOURCE {source.company}: {source.url}")
        listing, error = fetch_html(session, source.url, robots_cache)
        if not listing:
            update_source_health(health, company=source.company, name=source.name, url=source.url, transport="direct",
                                 attempted_at=now, transport_ok=False, observed_count=0, error=error, max_consecutive_empty_runs=max_empty)
            print(f"  DEGRADED {error}", file=sys.stderr); continue
        if source.listing_only:
            items = extract_listing_reports(listing, source, topic_keywords, now)
        else:
            items = []; links = discover_links(listing, source); print(f"  discovered {len(links)} ranked candidate links")
            for url in links:
                article, article_error = fetch_html(session, url, robots_cache)
                if not article:
                    if article_error == "robots_denied": print(f"  SKIP robots denied: {url}", file=sys.stderr)
                    continue
                item = extract_report(article, url, source, topic_keywords, now)
                if item: items.append(item)
        for item in items:
            merged, changed = merge_report(reports.get(item["url"]), item, now); reports[item["url"]] = merged; content_changed = content_changed or changed
        update_source_health(health, company=source.company, name=source.name, url=source.url, transport="direct",
                             attempted_at=now, transport_ok=True, observed_count=len(items), max_consecutive_empty_runs=max_empty)
        print(f"  observed {len(items)} dated research records")
    payload["reports"] = list(reports.values()); write_snapshot(payload, content_changed=content_changed, now=now); write_source_health(health)
    print(f"DIRECT REFRESH attempted={attempted} reports={len(reports)} content_changed={content_changed}")
    return 0 if attempted else 2


if __name__ == "__main__":
    raise SystemExit(main())
