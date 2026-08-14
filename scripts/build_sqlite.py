from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "data" / "reports.json"
DB_PATH = ROOT / "data" / "consultant.db"
CONFIG_PATH = ROOT / "config" / "sources.json"

SCHEMA = """
PRAGMA journal_mode=DELETE;
PRAGMA foreign_keys=ON;

CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    url TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    discovered_at TEXT,
    last_seen_at TEXT,
    search_text TEXT NOT NULL
);

CREATE TABLE topics (
    name TEXT PRIMARY KEY
);

CREATE TABLE report_topics (
    report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    topic TEXT NOT NULL REFERENCES topics(name) ON DELETE CASCADE,
    PRIMARY KEY (report_id, topic)
);

CREATE TABLE sources (
    url TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    name TEXT NOT NULL
);

CREATE INDEX idx_reports_company_date ON reports(company, published_at DESC);
CREATE INDEX idx_reports_date ON reports(published_at DESC);
CREATE INDEX idx_reports_source ON reports(source_name);
CREATE INDEX idx_report_topics_topic ON report_topics(topic, report_id);
"""


def normalize_topics(value):
    if isinstance(value, list):
        return sorted({str(item).strip() for item in value if str(item).strip()})
    if isinstance(value, str):
        return sorted({item.strip() for item in value.split("|") if item.strip()})
    return []


def main() -> None:
    payload = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    reports = payload.get("reports") or []
    updated_at = payload.get("updated_at") or ""

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="consultant-", suffix=".db", delete=False, dir=DB_PATH.parent) as tmp:
        tmp_path = Path(tmp.name)

    try:
        con = sqlite3.connect(tmp_path)
        con.executescript(SCHEMA)
        con.executemany(
            "INSERT INTO meta(key,value) VALUES(?,?)",
            [
                ("schema_version", "1"),
                ("updated_at", updated_at),
                ("record_count", str(len(reports))),
                ("database", "SQLite"),
            ],
        )

        topic_names = set()
        for row in reports:
            topics = normalize_topics(row.get("topics"))
            topic_names.update(topics)
            search_text = " ".join(
                [
                    str(row.get("company") or ""),
                    str(row.get("title") or ""),
                    str(row.get("description") or ""),
                    " ".join(topics),
                    str(row.get("source_name") or ""),
                ]
            ).lower()
            con.execute(
                """
                INSERT INTO reports(
                    id,company,title,published_at,url,description,source_name,
                    discovered_at,last_seen_at,search_text
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    str(row.get("id") or ""),
                    str(row.get("company") or ""),
                    str(row.get("title") or ""),
                    row.get("date") or None,
                    str(row.get("url") or ""),
                    str(row.get("description") or ""),
                    str(row.get("source_name") or ""),
                    row.get("discovered_at") or None,
                    row.get("last_seen_at") or None,
                    search_text,
                ),
            )
            con.executemany(
                "INSERT OR IGNORE INTO report_topics(report_id,topic) VALUES(?,?)",
                [(str(row.get("id") or ""), topic) for topic in topics],
            )

        con.executemany("INSERT INTO topics(name) VALUES(?)", [(name,) for name in sorted(topic_names)])

        for source in config.get("sources") or []:
            con.execute(
                "INSERT OR REPLACE INTO sources(url,company,name) VALUES(?,?,?)",
                (str(source.get("url") or ""), str(source.get("company") or ""), str(source.get("name") or "")),
            )

        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity_check failed: {integrity}")

        con.commit()
        con.close()
        tmp_path.replace(DB_PATH)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    size = DB_PATH.stat().st_size
    print(f"SQLite PASS: {DB_PATH.relative_to(ROOT)} | {len(reports)} reports | {len(topic_names)} topics | {size:,} bytes")


if __name__ == "__main__":
    main()
