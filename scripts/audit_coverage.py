#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from common import company_ingestion_status, load_source_health, parse_iso_date

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "reports.json"
CONFIG_PATH = ROOT / "config" / "sources.json"
COMPANIES = ("McKinsey", "BCG", "Deloitte", "PwC")
HUB_TITLE_HINTS = {"industry","strategy","operations","talent","technology management","consulting services","audit and assurance services","alliances","deals","global tax services","workforce trends"}

def main() -> int:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")); policy = config.get("health_policy") or {}
    max_age_days = int(policy.get("content_max_age_days",60)); min_reports = int(policy.get("min_reports_per_company",3))
    payload = json.loads(DB_PATH.read_text(encoding="utf-8")); reports = payload.get("reports",[]); health = load_source_health(); today = datetime.now(timezone.utc).date()
    failures: list[str] = []; warnings: list[str] = []
    urls = [str(item.get("url") or "") for item in reports]; duplicate_urls = sum(count-1 for count in Counter(urls).values() if count > 1)
    if duplicate_urls: failures.append(f"duplicate URLs: {duplicate_urls}")
    undated = [item for item in reports if not parse_iso_date(item.get("date"))]
    if undated: failures.append(f"undated rows: {len(undated)}")
    suspicious = [item for item in reports if str(item.get("title","")).strip().lower() in HUB_TITLE_HINTS]
    print(f"updated_at: {payload.get('updated_at')}"); print(f"total_reports: {len(reports)}")
    print("\ncompany,count,latest_date,latest_age_days,content_status,ingestion_status,observed,last_success")
    for company in COMPANIES:
        rows = [row for row in reports if row.get("company") == company]; dates = [parse_iso_date(row.get("date")) for row in rows]; dates = [value for value in dates if value]
        latest = max(dates,default=None); age = (today-latest).days if latest else None; content_status = "PASS"
        if len(rows) < min_reports: content_status = "FAIL"; failures.append(f"{company}: only {len(rows)} reports")
        elif age is None or age > max_age_days: content_status = "FAIL"; failures.append(f"{company}: latest report is stale ({latest})")
        ingestion_status, observed, last_success = company_ingestion_status(health,company)
        if ingestion_status == "fail": failures.append(f"{company}: ingestion failed for all configured sources")
        elif ingestion_status in {"degraded","unknown"}: warnings.append(f"{company}: ingestion {ingestion_status}; serving cached validated content")
        print(f"{company},{len(rows)},{latest or ''},{age if age is not None else ''},{content_status},{ingestion_status},{observed},{last_success}")
    print(f"\nundated_rows: {len(undated)}"); print(f"duplicate_urls: {duplicate_urls}"); print(f"suspicious_exact_hub_titles: {len(suspicious)}")
    for item in suspicious[:10]: print(f"  HUB? {item.get('company')}: {item.get('title')} -> {urlparse(item.get('url','')).path}")
    if warnings:
        print("\nCOVERAGE_WARNINGS")
        for warning in warnings: print(f"- {warning}")
    if failures:
        print("\nCOVERAGE_AUDIT: FAIL")
        for failure in failures: print(f"- {failure}")
        return 1
    print("\nCOVERAGE_AUDIT: PASS" if not warnings else "\nCOVERAGE_AUDIT: DEGRADED")
    return 0

if __name__ == "__main__": raise SystemExit(main())
