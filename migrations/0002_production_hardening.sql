ALTER TABLE reports ADD COLUMN last_checked_at TEXT;
ALTER TABLE reports ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN last_http_status INTEGER;

CREATE INDEX IF NOT EXISTS idx_reports_active_checked
  ON reports(active, last_checked_at);

CREATE TABLE IF NOT EXISTS coverage_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coverage_audits_checked
  ON coverage_audits(checked_at DESC);

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '2');
