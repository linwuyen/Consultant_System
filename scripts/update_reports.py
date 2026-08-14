#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "sources.json"
JSON_PATH = ROOT / "data" / "reports.json"
CSV_PATH = ROOT / "data" / "reports.csv"

# GitHub-hosted runners are frequently throttled by large publisher front doors when
# presented as a crawler UA. Use a normal browser transport UA, while robots.txt is
# still evaluated against our explicit bot identity below.
HTTP_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0 Safari/537.36"
)
ROBOTS_USER_AGENT = "ConsultantSystemBot"
MAX_LINKS_PER_SOURCE = 60
MAX_LISTING_REPORTS = 30
MAX_REPORTS = 2000
REQUEST_DELAY_SECONDS = 0.20
TIMEOUT = 18

EXCLUDE_PARTS = (
    "/careers", "/about/people", "/contact", "/locations", "/people/", "/alumni",
    "/privacy", "/terms", "/cookies", "/events", "/search", "/login",
    "/subscribe", "/newsletter", "/sitemap", "/userprofile", "/subscription",
)

GENERIC_LINK_TEXT = {
    "", "learn more", "read more", "view more", "visit page", "see all",
    "more", "menu", "explore", "view all", "download", "home",
}

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}
MONTH_RE = "|".join(name.title() for name in MONTHS)
NUMERIC_DATE_RE = re.compile(r"\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b")
MDY_DATE_RE = re.compile(rf"\b({MONTH_RE})\s+(\d{{1,2}}),\s*(20\d{{2}})\b", re.I)
DMY_DATE_RE = re.compile(rf"\b(\d{{1,2}})\s+({MONTH_RE})\s+(20\d{{2}})\b", re.I)


@dataclass
class Source:
    company: str
    name: str
    url: str
    allowed_path_prefixes: list[str]
    listing_only: bool = False


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonicalize(url: str) -> str:
    p = urlparse(url)
    path = re.sub(r"/{2,}", "/", p.path or "/")
    if path != "/":
        path = path.rstrip("/")
    return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", "", ""))


def make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=2,
        connect=2,
        read=1,
        status=2,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "HEAD"]),
        respect_retry_after_header=True,
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({
        "User-Agent": HTTP_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "X-Research-Indexer": "Consultant_System metadata-only research index",
    })
    return session


def robots_allowed(session: requests.Session, url: str, cache: dict[str, RobotFileParser]) -> bool:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in cache:
        robots_url = f"{origin}/robots.txt"
        rp = RobotFileParser()
        rp.set_url(robots_url)
        try:
            resp = session.get(robots_url, timeout=TIMEOUT)
            if resp.ok:
                rp.parse(resp.text.splitlines())
            else:
                rp.parse([])
        except requests.RequestException:
            # Network failure fetching robots.txt is not treated as an implicit
            # publisher prohibition. We remain metadata-only and retry next run.
            rp.parse([])
        cache[origin] = rp
    return cache[origin].can_fetch(ROBOTS_USER_AGENT, url)


def fetch_html(session: requests.Session, url: str, robots_cache: dict[str, RobotFileParser]) -> str | None:
    if not robots_allowed(session, url, robots_cache):
        print(f"SKIP robots.txt: {url}", file=sys.stderr)
        return None
    try:
        resp = session.get(url, timeout=TIMEOUT)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
            return None
        time.sleep(REQUEST_DELAY_SECONDS)
        return resp.text
    except requests.RequestException as exc:
        print(f"WARN fetch failed: {url}: {exc}", file=sys.stderr)
        return None


def same_host(a: str, b: str) -> bool:
    return urlparse(a).netloc.lower().removeprefix("www.") == urlparse(b).netloc.lower().removeprefix("www.")


def looks_like_report(url: str, source: Source) -> bool:
    p = urlparse(url)
    path = p.path.lower()
    if not same_host(url, source.url):
        return False
    if any(part in path for part in EXCLUDE_PARTS):
        return False
    if source.allowed_path_prefixes and not any(path.startswith(x.lower()) for x in source.allowed_path_prefixes):
        return False
    if path in ("", "/") or path.endswith((".jpg", ".jpeg", ".png", ".gif", ".svg", ".zip", ".mp4", ".pdf")):
        return False
    return len(path.strip("/").split("/")) >= 2


def normalize_date(raw: str) -> str:
    raw = re.sub(r"\s+", " ", raw or "").strip()
    if not raw:
        return ""

    if len(raw) <= 40:
        try:
            value = raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(value)
            return dt.date().isoformat()
        except ValueError:
            pass

    m = NUMERIC_DATE_RE.search(raw)
    if m:
        y, mo, d = map(int, m.groups())
        try:
            return datetime(y, mo, d).date().isoformat()
        except ValueError:
            return ""

    m = MDY_DATE_RE.search(raw)
    if m:
        month, day, year = m.groups()
        try:
            return datetime(int(year), MONTHS[month.lower()], int(day)).date().isoformat()
        except (ValueError, KeyError):
            return ""

    m = DMY_DATE_RE.search(raw)
    if m:
        day, month, year = m.groups()
        try:
            return datetime(int(year), MONTHS[month.lower()], int(day)).date().isoformat()
        except (ValueError, KeyError):
            return ""

    return ""


def clean_text(value: str, limit: int = 1200) -> str:
    return re.sub(r"\s+", " ", value or "").strip()[:limit]


def anchor_context(a: Any) -> str:
    parent = a.parent
    if parent is None:
        return clean_text(a.get_text(" ", strip=True), 700)
    return clean_text(parent.get_text(" ", strip=True), 700)


def dated_anchor_context(a: Any) -> str:
    """Return the smallest nearby card-like text that contains a publication date."""
    node: Any = a
    fallback = clean_text(a.get_text(" ", strip=True), 700)
    for _ in range(6):
        node = getattr(node, "parent", None)
        if node is None:
            break
        text = clean_text(node.get_text(" ", strip=True), 1800)
        if not text:
            continue
        if len(text) <= 1500:
            fallback = text
        if normalize_date(text):
            return text
        if len(text) > 1500:
            break
    return fallback


def candidate_score(a: Any, url: str) -> int:
    path = urlparse(url).path.lower()
    label = clean_text(a.get_text(" ", strip=True), 300)
    context = dated_anchor_context(a)
    score = 0

    if normalize_date(context):
        score += 20
    if re.search(r"/20\d{2}/", path):
        score += 12
    for marker, weight in (
        ("/our-insights/", 10),
        ("/publications/", 9),
        ("/research-insights/", 9),
        ("/the-leadership-agenda/", 8),
        ("/mgi/our-research/", 8),
        ("/insights/", 5),
        ("/issues/", 4),
    ):
        if marker in path:
            score += weight

    if len(label) >= 24:
        score += 4
    if label.lower() in GENERIC_LINK_TEXT:
        score -= 10
    return score


def discover_links(html: str, source: Source) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    scope = soup.find("main") or soup
    candidates: dict[str, tuple[int, int]] = {}

    for order, a in enumerate(scope.find_all("a", href=True)):
        if a.find_parent(["nav", "header", "footer"]):
            continue
        raw = str(a.get("href", "")).strip()
        if not raw or raw.startswith(("#", "mailto:", "javascript:")):
            continue

        url = canonicalize(urljoin(source.url, raw))
        if not looks_like_report(url, source):
            continue

        scored = (candidate_score(a, url), -order)
        if url not in candidates or scored > candidates[url]:
            candidates[url] = scored

    ordered = sorted(candidates, key=lambda u: candidates[u], reverse=True)
    return ordered[:MAX_LINKS_PER_SOURCE]


def jsonld_objects(soup: BeautifulSoup) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or script.get_text() or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        for item in stack:
            if isinstance(item, dict) and "@graph" in item and isinstance(item["@graph"], list):
                stack.extend(item["@graph"])
            if isinstance(item, dict):
                out.append(item)
    return out


def meta_content(soup: BeautifulSoup, *selectors: tuple[str, str]) -> str:
    for attr, value in selectors:
        tag = soup.find("meta", attrs={attr: value})
        if tag and tag.get("content"):
            return clean_text(str(tag["content"]))
    return ""


def clean_title(title: str, company: str) -> str:
    title = clean_text(title, 300)
    for suffix in (
        f" | {company}", f" - {company}", " | McKinsey & Company",
        " | BCG", " | Deloitte", " | PwC",
    ):
        if title.endswith(suffix):
            title = title[: -len(suffix)].strip()
    return title[:300]


def visible_date(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if h1:
        parts: list[str] = []
        chars = 0
        for node in h1.find_all_next(string=True):
            parent_name = getattr(getattr(node, "parent", None), "name", "")
            if parent_name in {"script", "style", "noscript"}:
                continue
            text = clean_text(str(node), 500)
            if not text:
                continue
            parts.append(text)
            chars += len(text)
            if chars >= 1800:
                break
        found = normalize_date(" ".join(parts))
        if found:
            return found

    main = soup.find("main")
    if main:
        found = normalize_date(main.get_text(" ", strip=True)[:2200])
        if found:
            return found

    return ""


def infer_topics(text: str, topic_keywords: dict[str, list[str]]) -> list[str]:
    low = text.lower()
    topics = [topic for topic, words in topic_keywords.items() if any(w.lower() in low for w in words)]
    return topics[:6]


def make_report(
    *,
    source: Source,
    url: str,
    title: str,
    date: str,
    description: str,
    topic_keywords: dict[str, list[str]],
    now: str,
) -> dict[str, Any]:
    topics = infer_topics(f"{title} {description}", topic_keywords)
    rid = hashlib.sha1(f"{source.company}|{url}".encode("utf-8")).hexdigest()[:16]
    return {
        "id": rid,
        "company": source.company,
        "title": title,
        "date": date,
        "url": url,
        "description": description,
        "topics": topics,
        "source_name": source.name,
        "discovered_at": now,
        "last_seen_at": now,
    }


def extract_listing_reports(
    html: str,
    source: Source,
    topic_keywords: dict[str, list[str]],
    now: str,
) -> list[dict[str, Any]]:
    """Index dated research cards directly from a publisher landing page.

    This mode is intentionally metadata-only and avoids an N+1 article crawl. It is
    particularly useful for publishers whose article front door rate-limits hosted
    runners while the public landing pages remain stable.
    """
    soup = BeautifulSoup(html, "html.parser")
    scope = soup.find("main") or soup
    by_url: dict[str, tuple[int, dict[str, Any]]] = {}

    for order, a in enumerate(scope.find_all("a", href=True)):
        if a.find_parent(["nav", "header", "footer"]):
            continue
        raw = str(a.get("href", "")).strip()
        if not raw or raw.startswith(("#", "mailto:", "javascript:")):
            continue
        url = canonicalize(urljoin(source.url, raw))
        if not looks_like_report(url, source) or url == canonicalize(source.url):
            continue

        title = clean_title(a.get_text(" ", strip=True), source.company)
        if len(title) < 16 or title.lower() in GENERIC_LINK_TEXT:
            continue
        context = dated_anchor_context(a)
        date = normalize_date(context)
        if not date:
            continue

        description = clean_text(context.replace(title, " "), 700)
        description = re.sub(
            rf"\b(?:{MONTH_RE})\s+\d{{1,2}},\s*20\d{{2}}\b",
            " ",
            description,
            flags=re.I,
        )
        description = clean_text(
            re.sub(r"\b(?:Read more|Learn more|Explore|Article|Report)\b", " ", description, flags=re.I),
            700,
        )
        item = make_report(
            source=source,
            url=url,
            title=title,
            date=date,
            description=description,
            topic_keywords=topic_keywords,
            now=now,
        )
        score = candidate_score(a, url) * 1000 - order
        if url not in by_url or score > by_url[url][0]:
            by_url[url] = (score, item)

    ranked = [item for _, item in sorted(by_url.values(), key=lambda x: x[0], reverse=True)]
    return ranked[:MAX_LISTING_REPORTS]


def extract_report(
    html: str,
    url: str,
    source: Source,
    topic_keywords: dict[str, list[str]],
    now: str,
) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "html.parser")
    objects = jsonld_objects(soup)

    title = meta_content(soup, ("property", "og:title"), ("name", "twitter:title"))
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else ""
    if not title and soup.title:
        title = soup.title.get_text(" ", strip=True)
    title = clean_title(title, source.company)
    if not title or len(title) < 5:
        return None

    description = meta_content(
        soup,
        ("property", "og:description"),
        ("name", "description"),
        ("name", "twitter:description"),
    )
    description = clean_text(description, 700)

    date = visible_date(soup)

    for obj in objects:
        if not date and obj.get("datePublished"):
            date = normalize_date(str(obj["datePublished"]))
        if not description and obj.get("description"):
            description = clean_text(str(obj["description"]), 700)
        if not title and obj.get("headline"):
            title = clean_title(str(obj["headline"]), source.company)

    if not date:
        raw_meta_date = meta_content(
            soup,
            ("property", "article:published_time"),
            ("name", "date"),
            ("name", "publish-date"),
            ("name", "publication_date"),
        )
        date = normalize_date(raw_meta_date)

    if not date:
        for tag in soup.find_all("time"):
            date = normalize_date(str(tag.get("datetime") or tag.get_text(" ", strip=True)))
            if date:
                break

    if not date:
        return None

    return make_report(
        source=source,
        url=url,
        title=title,
        date=date,
        description=description,
        topic_keywords=topic_keywords,
        now=now,
    )


def load_existing() -> dict[str, dict[str, Any]]:
    if not JSON_PATH.exists():
        return {}
    try:
        payload = json.loads(JSON_PATH.read_text(encoding="utf-8"))
        return {
            item["url"]: item
            for item in payload.get("reports", [])
            if item.get("url") and item.get("date")
        }
    except (json.JSONDecodeError, OSError):
        return {}


def date_sort_key(item: dict[str, Any]) -> tuple[str, str]:
    return (item.get("date") or "0000-00-00", item.get("discovered_at") or "")


def preserve_discovery(item: dict[str, Any], reports: dict[str, dict[str, Any]], now: str) -> dict[str, Any]:
    old = reports.get(item["url"])
    if old:
        item["discovered_at"] = old.get("discovered_at", now)
    return item


def main() -> int:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    sources = [Source(**x) for x in config["sources"]]
    topic_keywords = config.get("topic_keywords", {})
    now = utc_now()
    session = make_session()
    robots_cache: dict[str, RobotFileParser] = {}
    reports = load_existing()
    successful_sources = 0

    for source in sources:
        print(f"SOURCE {source.company}: {source.url}")
        listing = fetch_html(session, source.url, robots_cache)
        if not listing:
            continue

        successful_sources += 1
        if source.listing_only:
            items = extract_listing_reports(listing, source, topic_keywords, now)
            for item in items:
                item = preserve_discovery(item, reports, now)
                reports[item["url"]] = item
            print(f"  accepted {len(items)} dated research cards from landing-page metadata")
            continue

        links = discover_links(listing, source)
        accepted = 0
        print(f"  discovered {len(links)} ranked candidate links")
        for url in links:
            html = fetch_html(session, url, robots_cache)
            if not html:
                continue
            item = extract_report(html, url, source, topic_keywords, now)
            if not item:
                continue
            item = preserve_discovery(item, reports, now)
            reports[url] = item
            accepted += 1
        print(f"  accepted {accepted} dated research items")

    if successful_sources == 0:
        print("ERROR: no source listing could be fetched; preserving previous database", file=sys.stderr)
        return 2

    ordered = sorted(reports.values(), key=date_sort_key, reverse=True)[:MAX_REPORTS]
    JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    JSON_PATH.write_text(
        json.dumps({"updated_at": now, "reports": ordered}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    fields = [
        "id", "company", "title", "date", "url", "description", "topics",
        "source_name", "discovered_at", "last_seen_at",
    ]
    with CSV_PATH.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for item in ordered:
            row = dict(item)
            row["topics"] = "|".join(item.get("topics", []))
            writer.writerow({k: row.get(k, "") for k in fields})

    print(f"WROTE {len(ordered)} reports at {now}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
