from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "data" / "reports.json"
HEALTH_PATH = ROOT / "data" / "source_health.json"
DB_PATH = ROOT / "data" / "consultant.db"
CONFIG_PATH = ROOT / "config" / "sources.json"

SCHEMA = """
PRAGMA journal_mode=DELETE;
PRAGMA foreign_keys=ON;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE reports (
 id TEXT PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL, published_at TEXT,
 url TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL DEFAULT '',
 discovered_at TEXT, last_seen_at TEXT, published_at_source TEXT NOT NULL DEFAULT '',
 description_source TEXT NOT NULL DEFAULT '', observation_mode TEXT NOT NULL DEFAULT '',
 topic_method TEXT NOT NULL DEFAULT '', search_text TEXT NOT NULL
);
CREATE TABLE topics (name TEXT PRIMARY KEY);
CREATE TABLE report_topics (report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, topic TEXT NOT NULL REFERENCES topics(name) ON DELETE CASCADE, PRIMARY KEY (report_id, topic));
CREATE TABLE sources (url TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, transport TEXT NOT NULL);
CREATE TABLE source_health (
 source_key TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, transport TEXT NOT NULL,
 last_attempt_at TEXT, last_success_at TEXT, transport_ok INTEGER NOT NULL DEFAULT 0,
 observed_count INTEGER NOT NULL DEFAULT 0, consecutive_empty_runs INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_reports_company_date ON reports(company, published_at DESC);
CREATE INDEX idx_reports_date ON reports(published_at DESC);
CREATE INDEX idx_reports_source ON reports(source_name);
CREATE INDEX idx_report_topics_topic ON report_topics(topic, report_id);
CREATE INDEX idx_source_health_company ON source_health(company, status);
"""

def normalize_topics(value):
    if isinstance(value,list): return sorted({str(item).strip() for item in value if str(item).strip()})
    if isinstance(value,str): return sorted({item.strip() for item in value.split("|") if item.strip()})
    return []

def main() -> None:
    payload = json.loads(JSON_PATH.read_text(encoding="utf-8")); config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    health = json.loads(HEALTH_PATH.read_text(encoding="utf-8")) if HEALTH_PATH.exists() else {"sources":{}}
    reports = payload.get("reports") or []; normalized = [(row,normalize_topics(row.get("topics"))) for row in reports]; topic_names = sorted({topic for _,topics in normalized for topic in topics})
    DB_PATH.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="consultant-",suffix=".db",delete=False,dir=DB_PATH.parent) as tmp: tmp_path = Path(tmp.name)
    try:
        con = sqlite3.connect(tmp_path); con.executescript(SCHEMA)
        con.executemany("INSERT INTO meta(key,value) VALUES(?,?)",[("schema_version","2"),("updated_at",payload.get("updated_at") or ""),("health_updated_at",health.get("updated_at") or ""),("record_count",str(len(reports))),("database","SQLite")])
        con.executemany("INSERT INTO topics(name) VALUES(?)",[(name,) for name in topic_names])
        for row,topics in normalized:
            search_text = " ".join([str(row.get("company") or ""),str(row.get("title") or ""),str(row.get("description") or "")," ".join(topics),str(row.get("source_name") or "")]).lower()
            con.execute("""INSERT INTO reports(id,company,title,published_at,url,description,source_name,discovered_at,last_seen_at,published_at_source,description_source,observation_mode,topic_method,search_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (str(row.get("id") or ""),str(row.get("company") or ""),str(row.get("title") or ""),row.get("date") or None,str(row.get("url") or ""),str(row.get("description") or ""),str(row.get("source_name") or ""),row.get("discovered_at") or None,row.get("last_seen_at") or None,str(row.get("published_at_source") or ""),str(row.get("description_source") or ""),str(row.get("observation_mode") or ""),str(row.get("topic_method") or ""),search_text))
            con.executemany("INSERT INTO report_topics(report_id,topic) VALUES(?,?)",[(str(row.get("id") or ""),topic) for topic in topics])
        for transport,key in (("direct","sources"),("reader","fallback_sources")):
            for source in config.get(key) or []:
                con.execute("INSERT OR REPLACE INTO sources(url,company,name,transport) VALUES(?,?,?,?)",(str(source.get("url") or ""),str(source.get("company") or ""),str(source.get("name") or ""),transport))
        for row in (health.get("sources") or {}).values():
            con.execute("""INSERT OR REPLACE INTO source_health(source_key,company,name,url,transport,last_attempt_at,last_success_at,transport_ok,observed_count,consecutive_empty_runs,status,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (row.get("source_key"),row.get("company"),row.get("name"),row.get("url"),row.get("transport"),row.get("last_attempt_at") or None,row.get("last_success_at") or None,1 if row.get("transport_ok") else 0,int(row.get("observed_count") or 0),int(row.get("consecutive_empty_runs") or 0),row.get("status") or "unknown",row.get("last_error") or ""))
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok": raise RuntimeError(f"SQLite integrity_check failed: {integrity}")
        con.commit(); con.close(); tmp_path.replace(DB_PATH)
    finally:
        if tmp_path.exists(): tmp_path.unlink()
    print(f"SQLite PASS: {DB_PATH.relative_to(ROOT)} | schema v2 | {len(reports)} reports | {len(topic_names)} topics | {DB_PATH.stat().st_size:,} bytes")

if __name__ == "__main__": main()
