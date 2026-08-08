#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "reports.json"
COMPANIES = ("McKinsey", "BCG", "Deloitte", "PwC")
MAX_LATEST_AGE_DAYS = 60
MIN_REPORTS_PER_COMPANY = 3

HUB_TITLE_HINTS = {
    "industry", "strategy", "operations", "talent", "technology management",
    "consulting services", "audit and assurance services", "alliances",
    "deals", "global tax services", "workforce trends",
}


def parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def main() -> int:
    payload = json.loads(DB_PATH.read_text(encoding="utf-8"))
    reports = payload.get("reports", [])
    today = datetime.now(timezone.utc).date()

    print(f"updated_at: {payload.get('updated_at')}")
    print(f"total_reports: {len(reports)}")

    failures: list[str] = []
    urls = [item.get("url", "") for item in reports]
    duplicate_urls = sum(v - 1 for v in Counter(urls).values() if v > 1)
    if duplicate_urls:
        failures.append(f"duplicate URLs: {duplicate_urls}")

    undated = [item for item in reports if not parse_date(item.get("date", ""))]
    if undated:
        failures.append(f"undated rows: {len(undated)}")

    suspicious = [
        item for item in reports
        if str(item.get("title", "")).strip().lower() in HUB_TITLE_HINTS
    ]

    print("\ncompany,count,latest_date,latest_age_days,status")
    for company in COMPANIES:
        rows = [r for r in reports if r.get("company") == company]
        dated = [(parse_date(r.get("date", "")), r) for r in rows]
        dated = [(d, r) for d, r in dated if d]
        latest = max((d for d, _ in dated), default=None)
        age = (today - latest).days if latest else None

        status = "PASS"
        if len(rows) < MIN_REPORTS_PER_COMPANY:
            status = "FAIL"
            failures.append(f"{company}: only {len(rows)} reports")
        elif age is None or age > MAX_LATEST_AGE_DAYS:
            status = "FAIL"
            failures.append(f"{company}: latest report is stale ({latest})")

        print(f"{company},{len(rows)},{latest or ''},{age if age is not None else ''},{status}")

    print(f"\nundated_rows: {len(undated)}")
    print(f"duplicate_urls: {duplicate_urls}")
    print(f"suspicious_exact_hub_titles: {len(suspicious)}")

    if suspicious:
        for item in suspicious[:10]:
            print(f"  HUB? {item.get('company')}: {item.get('title')} -> {urlparse(item.get('url', '')).path}")

    if failures:
        print("\nCOVERAGE_AUDIT: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("\nCOVERAGE_AUDIT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
