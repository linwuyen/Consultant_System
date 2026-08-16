from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from common import company_ingestion_status, parse_iso_date

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
COMPANIES = ("McKinsey", "BCG", "Deloitte", "PwC")

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()

def main() -> None:
    reports_payload = json.loads((DATA / "reports.json").read_text(encoding="utf-8"))
    health_payload = json.loads((DATA / "source_health.json").read_text(encoding="utf-8")) if (DATA / "source_health.json").exists() else {"sources":{}}
    reports = reports_payload.get("reports") or []; companies = {}; overall = "healthy"
    for company in COMPANIES:
        rows = [r for r in reports if r.get("company") == company]; dates = [parse_iso_date(r.get("date")) for r in rows]; latest = max([d for d in dates if d],default=None)
        ingestion_status, observed, last_success = company_ingestion_status(health_payload,company)
        if ingestion_status == "fail": overall = "fail"
        elif ingestion_status in {"degraded","unknown"} and overall != "fail": overall = "degraded"
        companies[company] = {"records":len(rows),"latest_publication":latest.isoformat() if latest else None,"ingestion_status":ingestion_status,"observed_count":observed,"last_success_at":last_success or None}
    artifacts = {}
    for name in ("reports.json","reports.csv","consultant.db","source_health.json"):
        path = DATA / name
        if path.exists(): artifacts[name] = {"sha256":sha256(path),"bytes":path.stat().st_size}
    snapshot_seed = "|".join(item["sha256"] for item in artifacts.values())
    manifest = {"schema_version":2,"snapshot_id":hashlib.sha256(snapshot_seed.encode()).hexdigest()[:16],"generated_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),"content_updated_at":reports_payload.get("updated_at"),"health_updated_at":health_payload.get("updated_at"),"overall_health":overall,"contract":"research-context-only","score_influence":False,"companies":companies,"artifacts":artifacts}
    (DATA / "manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"MANIFEST PASS: {manifest['snapshot_id']} health={overall}")

if __name__ == "__main__": main()
