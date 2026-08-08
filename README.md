# Consultant System

真正有後端的顧問研究資料庫網站，追蹤：

- McKinsey & Company
- Boston Consulting Group (BCG)
- Deloitte
- PwC

## Current website

GitHub Pages fallback：

https://linwuyen.github.io/Consultant_System/

Cloudflare Worker 部署後，同一份前端會自動切換到 Cloudflare D1 API；GitHub Pages 則保留 JSON fallback，因此切換期間不會中斷。

## Production architecture

```text
McKinsey / BCG / Deloitte / PwC
              ↓
Cloudflare Worker scheduled crawler
              ↓
Cloudflare D1 (SQLite)
  ├─ reports
  ├─ sources
  ├─ crawl_runs
  └─ schema_meta
              ↓
Worker API
  ├─ GET /api/health
  ├─ GET /api/stats
  ├─ GET /api/filters
  ├─ GET /api/reports
  └─ POST /api/refresh   (ADMIN_TOKEN protected)
              ↓
Static assets / database web UI
```

Cloudflare cron：每天 `01:17 UTC`，即台灣時間 `09:17`。

## Database behavior

`/api/reports` 直接查 Cloudflare D1，不會把整份資料下載到瀏覽器再搜尋。

支援：

- 關鍵字 SQL 查詢
- 公司篩選
- 主題篩選
- 年份篩選
- 發布日期 / 公司 / 標題排序
- Server-side pagination
- 每頁 25 / 50 / 100
- Coverage dashboard
- 最新研究日期
- D1 crawl run 狀態

第一次 D1 是空資料庫時，Worker 會把 repository 現有 `data/reports.json` 當一次性 seed 匯入；之後 D1 成為正式資料源。

## Cloudflare files

```text
wrangler.jsonc                    # Worker / D1 / assets / cron
worker/index.js                   # API + crawler + scheduled handler
migrations/0001_init.sql          # D1 schema
site/                             # 前端
.github/workflows/cloudflare-worker.yml
```

D1 binding 使用 Cloudflare Wrangler automatic resource provisioning：`wrangler.jsonc` 不硬編碼 account-specific database ID，第一次 deploy 時 Wrangler 可自動建立並綁定 D1。

## GitHub Pages compatibility

GitHub Pages 仍保留：

```text
scripts/update_reports.py
data/reports.json
data/reports.csv
.github/workflows/pages.yml
```

前端啟動時會先測試 `/api/health`：

- API 可用 → Cloudflare D1 mode
- API 不可用 → GitHub JSON fallback mode

因此 Cloudflare migration 不會讓原網站直接失效。

## Cloudflare deployment

GitHub Actions workflow 已建立。唯一必需的 repository secret：

- `CLOUDFLARE_API_TOKEN`

`CLOUDFLARE_ACCOUNT_ID` 是可選的。若未設定，workflow 會先用 Cloudflare API token 嘗試自動解析 Account ID；若無法解析，Wrangler 仍會依 token context 嘗試推斷 account。

push `worker/**`、`site/**`、`migrations/**`、`wrangler.jsonc`、`package.json` 或 deployment workflow 本身時，會自動執行：

```text
Verify API token
↓
Resolve Cloudflare account when possible
↓
npm install
↓
wrangler whoami
↓
wrangler deploy --dry-run
↓
wrangler deploy
↓
D1 automatic provisioning
↓
GET /api/health
```

也可手動執行 `Deploy Cloudflare Worker` workflow。

## D1 schema

核心表：

```sql
reports(
  id,
  company,
  title,
  published_at,
  url,
  description,
  topics_json,
  source_name,
  discovered_at,
  last_seen_at,
  active
)
```

另外保存 `sources` 與 `crawl_runs`，因此可以追蹤來源健康度與每次更新結果，而不只是存文章列表。

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

研究結論與數字仍應回到官方原始來源驗證。
