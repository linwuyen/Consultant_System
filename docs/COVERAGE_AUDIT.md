# Coverage and Ingestion Health Audit

Production architecture 為 GitHub Actions + SQLite + GitHub Pages。此文件不再描述歷史 Cloudflare Worker / D1 架構。

## Why two gates exist

Publication freshness 與 ingestion health 是兩個不同訊號：

- 一篇 10 天前的文章仍在 DB，不代表今天 crawler 有成功觀測 publisher。
- 今天 crawler 暫時空抓，也不代表已驗證的 cached content 立刻失效。

因此 production audit 同時檢查 content 與 operation。

## Content gate

由 `scripts/audit_coverage.py` 驗證：每家公司最低 records、publication date、latest age、duplicate URL、undated rows。

## Ingestion gate

每個 configured source 寫入 `data/source_health.json`：

```text
last_attempt_at
last_success_at
transport_ok
observed_count
consecutive_empty_runs
status
last_error
```

Company-level status：

- `healthy`：至少一個 source 本輪有 dated observation
- `degraded`：本輪無 dated observation，但連續空抓尚未達 hard-fail threshold
- `fail`：該公司所有 configured sources 都達 hard-fail threshold

`degraded` 會明確警告但可發布 cached validated content；`fail` 會讓 coverage audit exit non-zero。

## Source of truth

`config/sources.json` 是 production source / fallback / policy / topic configuration 的 canonical source。
