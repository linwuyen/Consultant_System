# Consultant System

McKinsey、BCG、Deloitte、PwC 公開研究的自動更新 **SQLite 資料庫網站**。

## Website

**Production:** https://linwuyen.github.io/Consultant_System/

不需要 Cloudflare、Vercel、Supabase 或其他外部帳號；production 全部由 GitHub 提供。

## Production architecture

```text
config/sources.json
        ↓
McKinsey / BCG / Deloitte / PwC official research pages
        ↓
GitHub Actions · 每日 09:17 Asia/Taipei
        ↓
scripts/update_reports.py
        ↓
data/reports.json + data/reports.csv
        ↓
scripts/build_sqlite.py
        ↓
data/consultant.db   ← 真正 SQLite database
        ↓
GitHub Pages
        ↓
sql.js / WebAssembly
        ↓
Browser executes SQLite SQL directly
```

GitHub Pages 官方支援使用 GitHub Actions 自動部署；本專案利用這個機制發布網站。瀏覽器端使用 `sql.js` 的 WebAssembly build，直接載入 `consultant.db` 並執行 SQL。

## Database schema

`data/consultant.db` 是標準 SQLite database，主要 tables：

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

Indexes：

- `reports(company, published_at DESC)`
- `reports(published_at DESC)`
- `reports(source_name)`
- `report_topics(topic, report_id)`

每次 build 都執行 `PRAGMA integrity_check`，失敗則 CI 直接停止。

## Website features

首頁直接對 SQLite 執行查詢：

- 關鍵字搜尋
- 公司篩選
- Topic 篩選
- 年份篩選
- 日期 / 公司 / 標題排序
- SQL pagination
- Dashboard / Coverage
- Table / Card view
- SQLite / JSON / CSV download
- **SQL Console**

SQL Console 範例：

```sql
SELECT company, COUNT(*) AS reports, MAX(published_at) AS latest
FROM reports
GROUP BY company
ORDER BY reports DESC;
```

Console 為唯讀模式，只接受 `SELECT`、`WITH`、`PRAGMA`。

## Automatic refresh

Workflow：

```text
.github/workflows/update-reports.yml
```

排程：

```text
17 1 * * *  → 09:17 Asia/Taipei
```

每輪：

```text
crawl official sources
↓
four-firm coverage audit
↓
build consultant.db
↓
PRAGMA integrity_check
↓
commit reports.json / reports.csv / consultant.db
↓
GitHub Pages deployment triggered automatically
```

也可以在 GitHub Actions 手動執行 **Update SQLite research database**。

## GitHub Pages deployment

Workflow：

```text
.github/workflows/pages.yml
```

Deployment 會：

1. 重新從目前 JSON snapshot 建立 SQLite，確保網站永遠有 DB。
2. 安裝固定版本 `sql.js`。
3. 執行 JavaScript syntax check。
4. 將 `sql-wasm.js` / `sql-wasm.wasm` 與 `consultant.db` 一起放進 Pages artifact。
5. 發布到 GitHub Pages。

因此 production 不依賴 CDN，也沒有 API token、account ID 或外部 database credential。

## Canonical source configuration

唯一來源設定：

```text
config/sources.json
```

目前包含 McKinsey、BCG、Deloitte、PwC 的官方 research / insights 入口與 topic keyword rules。

## Coverage acceptance criteria

每家公司：

- `PASS`：至少 3 筆 dated records、日期完整、最新研究 ≤ 60 days
- `PARTIAL`：已有資料但完整度 / 新鮮度仍需改善
- `FAIL`：沒有可用 coverage

首頁會直接從 SQLite 聚合各家公司 records、dated ratio、latest date、undated count。

## Data policy

本 repository 不鏡像顧問公司的付費或受版權保護全文，只保存公開頁面的 metadata：

- 標題
- 發布日期
- 摘要 / meta description
- 公司
- 主題標籤
- 原始 URL
- 發現時間
- 最後確認時間

Crawler 尊重 `robots.txt`。研究結論與數字仍應回官方原始來源驗證。

## Main files

```text
config/sources.json                   canonical sources/topics
scripts/update_reports.py             scheduled metadata crawler
scripts/audit_coverage.py             four-firm quality audit
scripts/build_sqlite.py               JSON → relational SQLite builder
data/reports.json                     interoperable snapshot
data/reports.csv                      interoperable export
data/consultant.db                    production SQLite database
site/index.html                       database UI + SQL Console
site/app.js                           SQLite WASM query layer
site/styles.css                       UI
.github/workflows/update-reports.yml  scheduled DB refresh
.github/workflows/pages.yml           production GitHub Pages deploy
```

## Why this architecture

對這個 read-heavy research database，GitHub-only SQLite 的優點是：

- 一個帳號就能維運
- 沒有 cloud database credential
- 沒有 server bill
- SQLite 是真正 relational database
- DB file 可下載、備份、離線分析
- SQL 查詢直接在 browser 執行
- Git history 自帶 database snapshot history
- GitHub Actions 負責定時 ETL

如果未來資料量成長到瀏覽器載入 SQLite 檔不合理，再升級成 PostgreSQL / server-side API；目前不需要先承擔那個維運成本。
