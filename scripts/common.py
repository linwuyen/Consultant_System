from __future__ import annotations

import csv
import hashlib
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
REPORTS_JSON = DATA_DIR / "reports.json"
REPORTS_CSV = DATA_DIR / "reports.csv"
SOURCE_HEALTH_JSON = DATA_DIR / "source_health.json"

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}
MONTH_RE = "|".join(name.title() for name in MONTHS)
NUMERIC_DATE_RE = re.compile(r"\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b")
MDY_DATE_RE = re.compile(rf"\b({MONTH_RE})\s+(\d{{1,2}}),\s*(20\d{{2}})\b", re.I)
DMY_DATE_RE = re.compile(rf"\b(\d{{1,2}})\s+({MONTH_RE})\s+(20\d{{2}})\b", re.I)

REPORT_FIELDS = [
    "id", "company", "title", "date", "url", "description", "topics",
    "source_name", "discovered_at", "last_seen_at", "published_at_source",
    "description_source", "observation_mode", "topic_method",
]
STABLE_REPORT_FIELDS = [
    "id", "company", "title", "date", "url", "description", "topics",
    "source_name", "published_at_source", "description_source",
    "observation_mode", "topic_method",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonicalize(url: str) -> str:
    parsed = urlparse(url)
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), path, "", "", ""))


def normalize_date(raw: str | None) -> str:
    raw = re.sub(r"\s+", " ", raw or "").strip()
    if not raw:
        return ""
    if len(raw) <= 48:
        try:
            value = raw.replace("Z", "+00:00")
            return datetime.fromisoformat(value).date().isoformat()
        except ValueError:
            pass
    match = NUMERIC_DATE_RE.search(raw)
    if match:
        year, month, day = map(int, match.groups())
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return ""
    match = MDY_DATE_RE.search(raw)
    if match:
        month, day, year = match.groups()
        try:
            return date(int(year), MONTHS[month.lower()], int(day)).isoformat()
        except (ValueError, KeyError):
            return ""
    match = DMY_DATE_RE.search(raw)
    if match:
        day, month, year = match.groups()
        try:
            return date(int(year), MONTHS[month.lower()], int(day)).isoformat()
        except (ValueError, KeyError):
            return ""
    return ""


def clean_text(value: str | None, limit: int = 1200) -> str:
    return re.sub(r"\s+", " ", value or "").strip()[:limit]


def clean_description(value: str | None, *, title: str = "", limit: int = 700) -> str:
    text = value or ""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[[^\]]+\]\((?:https?://)[^)]+\)", " ", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"(?:url|src)=https?%3A\S+", " ", text, flags=re.I)
    text = re.sub(r"\b(?:Image|Figure)\s*\d+\b", " ", text, flags=re.I)
    text = re.sub(r"\b(?:Read more|Learn more|Explore|View all|See all)\b", " ", text, flags=re.I)
    text = re.sub(rf"\b(?:{MONTH_RE})\s+\d{{1,2}},\s*20\d{{2}}\b", " ", text, flags=re.I)
    text = re.sub(r"\b(?:Article|Report|Podcast|Video|Perspective|Publication)\b", " ", text, flags=re.I)
    if title:
        text = text.replace(title, " ")
    text = clean_text(text, limit)
    if "%2f" in text.lower() or "amazonaws.com" in text.lower() or "brightspot" in text.lower():
        candidates = [clean_text(x, limit) for x in re.split(r"(?<=[.!?])\s+", text)]
        candidates = [x for x in candidates if len(x) >= 35 and "%2f" not in x.lower() and "amazonaws.com" not in x.lower()]
        text = candidates[0] if candidates else ""
    return text[:limit]


def _keyword_match(text: str, keyword: str) -> bool:
    keyword = clean_text(keyword).lower()
    if not keyword:
        return False
    if len(keyword) <= 3 and keyword.isalnum():
        return re.search(rf"\b{re.escape(keyword)}\b", text) is not None
    return keyword in text


def infer_topics(text: str, topic_keywords: dict[str, list[str]]) -> list[str]:
    low = clean_text(text, 5000).lower()
    return [topic for topic, keywords in topic_keywords.items() if any(_keyword_match(low, str(keyword)) for keyword in keywords)][:6]


def report_id(company: str, url: str) -> str:
    return hashlib.sha1(f"{company}|{canonicalize(url)}".encode("utf-8")).hexdigest()[:16]


def make_report(*, company: str, source_name: str, url: str, title: str, published_at: str, description: str,
                topic_keywords: dict[str, list[str]], now: str, published_at_source: str,
                description_source: str, observation_mode: str) -> dict[str, Any]:
    canonical_url = canonicalize(url)
    description = clean_description(description, title=title)
    topics = infer_topics(f"{title} {description}", topic_keywords)
    return {
        "id": report_id(company, canonical_url), "company": company, "title": clean_text(title, 300),
        "date": published_at, "url": canonical_url, "description": description, "topics": topics,
        "source_name": source_name, "discovered_at": now, "last_seen_at": now,
        "published_at_source": published_at_source, "description_source": description_source,
        "observation_mode": observation_mode, "topic_method": "keyword-v2",
    }


def stable_report(row: dict[str, Any]) -> dict[str, Any]:
    out = {field: row.get(field) for field in STABLE_REPORT_FIELDS}
    out["topics"] = sorted(str(x) for x in (row.get("topics") or []))
    return out


def merge_report(existing: dict[str, Any] | None, observed: dict[str, Any], now: str) -> tuple[dict[str, Any], bool]:
    if not existing:
        return observed, True
    merged = dict(observed)
    merged["discovered_at"] = existing.get("discovered_at") or observed.get("discovered_at") or now
    changed = stable_report(existing) != stable_report(observed)
    merged["last_seen_at"] = now if changed else (existing.get("last_seen_at") or existing.get("discovered_at") or now)
    return merged, changed


def load_snapshot() -> dict[str, Any]:
    if not REPORTS_JSON.exists():
        return {"updated_at": "", "reports": []}
    try:
        return json.loads(REPORTS_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"updated_at": "", "reports": []}


def reports_by_url(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {canonicalize(str(row.get("url") or "")): row for row in payload.get("reports", []) if row.get("url") and row.get("date")}


def _report_sort_key(row: dict[str, Any]) -> tuple[str, str]:
    return (str(row.get("date") or "0000-00-00"), str(row.get("discovered_at") or ""))


def write_snapshot(payload: dict[str, Any], *, content_changed: bool, now: str, max_reports: int = 2000) -> bool:
    reports = sorted(payload.get("reports", []), key=_report_sort_key, reverse=True)[:max_reports]
    payload = {"updated_at": now if content_changed else (payload.get("updated_at") or now), "reports": reports}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    existing_json = REPORTS_JSON.read_text(encoding="utf-8") if REPORTS_JSON.exists() else ""
    if json_text != existing_json:
        REPORTS_JSON.write_text(json_text, encoding="utf-8")
    rows: list[dict[str, Any]] = []
    for item in reports:
        row = {field: item.get(field, "") for field in REPORT_FIELDS}
        row["topics"] = "|".join(item.get("topics") or [])
        rows.append(row)
    from io import StringIO
    sio = StringIO(newline="")
    writer = csv.DictWriter(sio, fieldnames=REPORT_FIELDS)
    writer.writeheader(); writer.writerows(rows)
    csv_text = sio.getvalue()
    existing_csv = REPORTS_CSV.read_text(encoding="utf-8") if REPORTS_CSV.exists() else ""
    if csv_text != existing_csv:
        REPORTS_CSV.write_text(csv_text, encoding="utf-8", newline="")
    return content_changed


def source_key(company: str, name: str, url: str, transport: str) -> str:
    raw = f"{company}|{name}|{canonicalize(url)}|{transport}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def load_source_health() -> dict[str, Any]:
    if not SOURCE_HEALTH_JSON.exists():
        return {"updated_at": "", "sources": {}}
    try:
        payload = json.loads(SOURCE_HEALTH_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"updated_at": "", "sources": {}}
    if not isinstance(payload.get("sources"), dict):
        payload["sources"] = {}
    return payload


def update_source_health(payload: dict[str, Any], *, company: str, name: str, url: str, transport: str,
                         attempted_at: str, transport_ok: bool, observed_count: int, error: str = "",
                         max_consecutive_empty_runs: int = 3) -> dict[str, Any]:
    key = source_key(company, name, url, transport)
    old = dict(payload.setdefault("sources", {}).get(key) or {})
    consecutive = int(old.get("consecutive_empty_runs") or 0)
    success = transport_ok and observed_count > 0
    if success:
        consecutive = 0; last_success = attempted_at; status = "healthy"
    else:
        consecutive += 1; last_success = old.get("last_success_at") or ""
        status = "fail" if consecutive >= max_consecutive_empty_runs else "degraded"
    row = {
        "source_key": key, "company": company, "name": name, "url": canonicalize(url), "transport": transport,
        "last_attempt_at": attempted_at, "last_success_at": last_success, "transport_ok": bool(transport_ok),
        "observed_count": int(observed_count), "consecutive_empty_runs": consecutive, "status": status,
        "last_error": clean_text(error, 500),
    }
    payload["sources"][key] = row; payload["updated_at"] = attempted_at
    return row


def write_source_health(payload: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SOURCE_HEALTH_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def company_health_rows(health_payload: dict[str, Any], company: str) -> list[dict[str, Any]]:
    return [row for row in health_payload.get("sources", {}).values() if row.get("company") == company]


def company_ingestion_status(health_payload: dict[str, Any], company: str) -> tuple[str, int, str]:
    rows = company_health_rows(health_payload, company)
    if not rows:
        return "unknown", 0, ""
    observed = sum(int(row.get("observed_count") or 0) for row in rows)
    last_success = max((str(row.get("last_success_at") or "") for row in rows), default="")
    if any(row.get("status") == "healthy" for row in rows):
        return "healthy", observed, last_success
    if rows and all(row.get("status") == "fail" for row in rows):
        return "fail", observed, last_success
    return "degraded", observed, last_success


def parse_iso_date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(str(value or ""))
    except ValueError:
        return None
