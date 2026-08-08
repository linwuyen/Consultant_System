# Consultant System

真正有後端的顧問研究資料庫網站，追蹤：

- McKinsey & Company
- Boston Consulting Group (BCG)
- Deloitte
- PwC

## Website

<!-- PRODUCTION_URL_START -->
**Production:** Cloudflare Worker URL will be written here automatically after the first successful production deployment.

**GitHub Pages fallback:** https://linwuyen.github.io/Consultant_System/
<!-- PRODUCTION_URL_END -->

Cloudflare Worker 是正式 production；GitHub Pages 只保留 D1 匯出的 JSON/CSV snapshot 作為 fallback。

## Production architecture

```text
config/sources.json  ← single source of truth
        ↓
McKinsey / BCG / Deloitte / PwC official research pages
        ↓
Cloudflare Worker crawler
  ├─ robots.txt policy
  ├─ article/date validation
  ├─ topic tagging
  ├─ stale URL revalidation
  └─ four-firm coverage audit
        ↓
Cloudflare D1 (SQLite)
  ├─ reports
  ├─ sources
  ├─ crawl_runs
  ├─ coverage_audits
  └─ schema_meta
        ↓
Worker API
  ├─ GET  /api/health
  ├─ GET  /api/stats
  ├─ GET  /api/filters
  ├─ GET  /api/reports
  ├─ GET  /api/coverage
  ├─ GET  /api/export.json
  ├─ GET  /api/export.csv
  └─ POST /api/refresh
        ↓
Static assets / database web UI
```

Cloudflare cron：每天 `01:17 UTC`，即台灣時間 `09:17`。

## Database behavior

`/api/reports` 直接查 Cloudflare D1，不會把整份資料下載到瀏覽器再搜尋。

支援：

- 關鍵字 SQL 查詢
- 公司 / 主題 / 年份篩選
- 發布日期 / 公司 / 標題排序
- Server-side pagination
- 每頁 25 / 50 / 100
- Coverage dashboard
- 最新研究日期
- D1 crawl run 狀態
- JSON / CSV D1 export
- robots.txt 檢查
- 404 / 410 stale record 自動停用
- 每次 refresh 後自動保存 coverage audit history

第一次 D1 是空資料庫時，Worker 只會把 repository 現有 `data/reports.json` 中**有有效發布日期**的資料當一次性 seed 匯入；之後 D1 成為唯一正式資料源。

## Canonical source configuration

唯一來源設定：

```text
config/sources.json
```

Cloudflare Worker 不再維護另一份手寫 source list。部署前執行：

```bash
npm run generate:config
```

生成：

```text
worker/config.generated.js
```

因此 Python emergency fallback 與 Cloudflare production crawler 都以同一份 `config/sources.json` 為基準。

## D1 migrations

Schema 使用正式 versioned migrations：

```text
migrations/0001_init.sql
migrations/0002_production_hardening.sql
```

Production deployment 會執行：

```bash
npx wrangler d1 migrations apply DB --remote
```

D1 migration history 由 Cloudflare 的 `d1_migrations` table 保存。

目前 schema version：`2`。

## Cloudflare deployment

唯一必需的 GitHub repository secret：

- `CLOUDFLARE_API_TOKEN`

`CLOUDFLARE_ACCOUNT_ID` 是可選的；workflow 會優先自動解析，無法解析時交由 Wrangler 依 token context 推斷。

Cloudflare workflow：

```text
.github/workflows/cloudflare-worker.yml
```

每次 production deploy 會自動完成：

```text
Verify API token
↓
Resolve Cloudflare account when possible
↓
npm install
↓
Generate Worker config from config/sources.json
↓
JavaScript syntax checks
↓
wrangler deploy --dry-run
↓
wrangler deploy + D1 automatic provisioning
↓
Apply D1 migrations
↓
Rotate temporary ADMIN_TOKEN
↓
GET /api/health (schema_version must be 2)
↓
POST /api/refresh
↓
GET /api/coverage
↓
FAIL only if any of McKinsey / BCG / Deloitte / PwC has zero usable coverage
↓
Export D1 → data/reports.json + data/reports.csv
↓
Write production Worker URL into this README
↓
Commit fallback snapshot to GitHub
```

也可手動執行 `Deploy Cloudflare Worker` workflow；手動執行同時等同一次 production refresh，因此不需要自己保存 `ADMIN_TOKEN`。

## Coverage acceptance criteria

每家公司：

- `PASS`：至少 3 筆 active dated records、無 undated row、latest ≤ 60 days
- `PARTIAL`：至少 1 筆 dated record、latest ≤ 120 days
- `FAIL`：沒有可用近期 coverage

Production workflow：

- `FAIL` → workflow red
- `PARTIAL` → warning，但 deployment 保留
- `PASS` → full coverage pass

Coverage history 寫入 D1 `coverage_audits`。

## GitHub Pages fallback

GitHub Pages 仍部署：

```text
site/
data/reports.json
data/reports.csv
.github/workflows/pages.yml
```

但 `data/reports.*` 正常情況是由 **Cloudflare D1 export 自動回寫**，不是第二套 crawler。

前端啟動時：

- `/api/health` 可用 → Cloudflare D1 / Server-side SQL mode
- `/api/health` 不可用 → GitHub JSON fallback mode

JSON / CSV 按鈕也會自動切換：

- D1 mode → `/api/export.json` / `/api/export.csv`
- fallback mode → `data/reports.json` / `data/reports.csv`

## Legacy emergency crawler

舊 Python crawler 保留，但已取消 schedule，只能手動執行：

```text
.github/workflows/update-reports.yml
```

用途只有 Cloudflare production 故障時做 emergency fallback，不再與 D1 每天重複抓資料。

## Main files

```text
config/sources.json                         canonical sources/topics
scripts/generate_worker_config.mjs          Worker config generator
worker/config.generated.js                  generated deployment config
worker/index.js                             API + crawler + robots + coverage
migrations/0001_init.sql                    initial schema
migrations/0002_production_hardening.sql    health/coverage/stale schema
wrangler.jsonc                              Worker / D1 / assets / cron
site/                                       production + fallback UI
.github/workflows/cloudflare-worker.yml     production deploy/refresh/audit
.github/workflows/pages.yml                 GitHub Pages fallback deploy
.github/workflows/update-reports.yml        manual-only emergency crawler
```

## Data policy

本 repository / D1 不鏡像顧問公司的付費或受版權保護全文，只保存公開頁面的 metadata：

- 標題
- 發布日期
- 摘要 / meta description
- 公司
- 主題標籤
- 原始 URL
- 發現時間
- 最後確認時間
- URL health / active status

Crawler 會讀取 `robots.txt`；被禁止抓取的 URL 不會進行文章抓取。研究結論與數字仍應回到官方原始來源驗證。
