# Consultant System

McKinsey、BCG、Deloitte、PwC 公開研究的自動更新 **SQLite metadata 資料庫**，也是 `linwuyen/Elephant` 的外部顧問研究 ingestion layer。

## Website

**Production:** https://linwuyen.github.io/Consultant_System/

不需要 Cloudflare、Vercel、Supabase 或其他外部 database 帳號；production 由 GitHub Actions + GitHub Pages 提供。

## Production architecture

```text
McKinsey / BCG / Deloitte / PwC official research pages
                  ↓
        direct metadata crawler
                  +
  blocked-publisher reader fallback
                  ↓
       four-firm coverage gate
                  ↓
     reports.json / reports.csv
                  ↓
           consultant.db
         (real SQLite DB)
                  ↓
             GitHub Pages
                  ↓
        sql.js / WebAssembly
                  ↓
        browser executes SQL
                  ↓
      Elephant downstream sync
```

排程：**每日 09:17 Asia/Taipei**。Elephant 於 **10:17 Asia/Taipei** 再同步通過 gate 的 snapshot。

## Resilient publisher ingestion

`config/sources.json` 是 canonical source configuration。

資料擷取分兩條路：

1. `scripts/update_reports.py`：直接讀取可穩定存取的官方 research landing pages，保存 metadata，不鏡像全文。
2. `scripts/update_reader_fallback.py`：當 hosted runner 對特定 publisher front door 不穩定時，使用 reader transport 解析公開 landing-page metadata；**資料庫保存的 canonical URL 仍然是原始顧問公司的官方 URL**。

McKinsey 另保留一組經人工驗證的近期官方 metadata bootstrap，只在資料庫完全沒有 McKinsey records、live fallback 又沒有產生有效 dated records 時使用。它不是全文鏡像，也不會在每輪更新中冒充重新觀測到的資料。

## Hard four-firm production gate

正式資料庫不是「有抓到一些就發布」。每輪 production refresh 必須同時滿足：

- McKinsey ≥ 3 dated records
- BCG ≥ 3 dated records
- Deloitte ≥ 3 dated records
- PwC ≥ 3 dated records
- undated rows = 0
- duplicate URLs = 0
- 每家公司最新研究 ≤ 60 days
- SQLite `PRAGMA integrity_check = ok`
- relational schema contract 完整

任何 gate 失敗都停止 production DB commit，不把不完整 snapshot 當成正常資料發布。

## Database schema

`data/consultant.db` 是標準 SQLite database：

```text
reports
  id              PRIMARY KEY
  company
  title
  published_at
  url             UNIQUE
  description
  source_name
  discovered_at
  last_seen_at
  search_text

topics
  name            PRIMARY KEY

report_topics
  report_id        FK → reports.id
  topic            FK → topics.name
  PRIMARY KEY(report_id, topic)

sources
  url             PRIMARY KEY
  company
  name

meta
  key             PRIMARY KEY
  value
```

Indexes：`reports(company, published_at DESC)`、`reports(published_at DESC)`、`reports(source_name)`、`report_topics(topic, report_id)`。

## Website features

GitHub Pages 直接載入 SQLite，在 browser 內執行 SQL：

- 關鍵字搜尋
- 公司 / Topic / 年份篩選
- 日期 / 公司 / 標題排序
- SQL pagination
- Dashboard / Coverage
- Table / Card view
- SQLite / JSON / CSV download
- 唯讀 **SQL Console**（`SELECT` / `WITH` / `PRAGMA`）

例如：

```sql
SELECT company, COUNT(*) AS reports, MAX(published_at) AS latest
FROM reports
GROUP BY company
ORDER BY reports DESC;
```

## Automatic refresh

`.github/workflows/update-reports.yml`：

```text
09:17 Asia/Taipei
        ↓
syntax check
        ↓
direct official metadata crawl
        ↓
blocked-publisher metadata fallback
        ↓
HARD four-firm coverage audit
        ↓
build consultant.db
        ↓
SQLite integrity + company count gate
        ↓
fetch/rebase/push snapshot
        ↓
GitHub Pages
```

`.github/workflows/pages.yml` 會重建 SQLite、驗證 JavaScript、把 `sql-wasm.js` / `sql-wasm.wasm` / `consultant.db` 一起封裝成 Pages artifact。

## Elephant integration contract

Elephant 只消費這裡已發布且通過 gate 的：

```text
data/reports.json
data/reports.csv
data/consultant.db
```

Elephant 的同步層再次驗證四家公司與 SQLite integrity，並明確寫入：

```json
{
  "contract": "research-context-only",
  "score_influence": false
}
```

顧問研究可以成為 Elephant 的 Evidence / Contradictions / Risks / strategy context，**但不允許改變任何 deterministic economic score**。

## Data policy

只保存公開 metadata：標題、發布日期、摘要 / meta description、公司、topic、官方原始 URL、發現時間與最後確認時間。不鏡像付費或受版權保護全文。研究中的主張仍應回到官方原始頁面核對。

## Main files

```text
config/sources.json                   canonical source / fallback / topic config
scripts/update_reports.py             direct metadata crawler
scripts/update_reader_fallback.py     blocked-publisher metadata fallback
scripts/audit_coverage.py             hard four-firm quality gate
scripts/build_sqlite.py               JSON → relational SQLite
data/reports.json                     interoperable snapshot
data/reports.csv                      CSV export
data/consultant.db                    production SQLite DB
site/                                  database UI + SQL Console
.github/workflows/update-reports.yml  09:17 production refresh
.github/workflows/pages.yml           GitHub Pages deploy
```

## Why this architecture

對目前 read-heavy 的 research index，GitHub-only SQLite 的優點是低維運、沒有 database credential、資料庫可下載與離線查詢、Git history 自帶 snapshot history，且可以直接供 Elephant 消費。若未來資料量大到 browser SQLite 不合理，再升級 server-side database/API；目前沒有必要提早承擔那個複雜度。
