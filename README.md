# Consultant System

McKinsey、BCG、Deloitte、PwC 公開研究的自動更新 **research metadata + ingestion health** 資料庫，也是 `linwuyen/Elephant` 的外部顧問研究 evidence ingestion layer。

## Production architecture

```text
official research pages / official sitemap
        ↓
direct metadata crawler + reader fallback + sitemap heartbeat
        ↓
normalize / provenance / source health
        ↓
content quality gate + ingestion health gate
        ↓
reports.json / reports.csv / source_health.json
        ↓
consultant.db (SQLite schema v2)
        ↓
manifest.json (snapshot contract + hashes)
        ↓
GitHub Pages / Elephant
```

Production 由 GitHub Actions + GitHub Pages 提供，不需要 Cloudflare、D1、Vercel、Supabase 或常駐 API server。排程每日 09:17 Asia/Taipei。

## Correctness model

系統刻意把兩件事分開：

- **Content freshness**：資料庫中的最新研究是否夠新、日期是否完整、URL 是否重複。
- **Ingestion health**：本輪是否真的從 publisher 的公開 discovery surface 重新觀測到有效研究或已驗證研究 URL。

因此「DB 還有 60 天內文章」不再等同「crawler 健康」。來源連續空抓會依 `config/sources.json` 的 `health_policy.max_consecutive_empty_runs` 從 `degraded` 升級為 `fail`。

對 McKinsey 特別區分：官方 article/listing HTML 在 hosted runner 可能 timeout / block，但官方 `sitemap.xml` 是 publisher 公布給 crawler 的 discovery surface。系統可用 sitemap heartbeat 驗證已知官方 research URL 仍可被 live discovery；**sitemap 不提供可信 publication date 時，絕不把 sitemap fetch time 當文章日期**。

## Canonical configuration

`config/sources.json` 是 production crawler、health policy 與 topic keyword 的唯一 canonical configuration。

`catalog/` 與 `sources/*.md` 只提供人工研究入口與 publisher context，不是 production crawler source of truth。

## Data artifacts

```text
data/reports.json        canonical interoperable content snapshot
data/reports.csv         derived CSV export
data/source_health.json  operational ingestion state
data/consultant.db       relational SQLite snapshot
data/manifest.json       downstream contract, health summary and SHA-256 hashes
```

`reports.json.updated_at` 表示 **content snapshot 最後變更時間**，不是 crawler 最後執行時間。Operational freshness 請看 `source_health.json` / `manifest.json`。

## SQLite schema v2

`reports` 增加 `published_at_source`、`description_source`、`observation_mode`、`topic_method`；另新增 `source_health` table。`last_seen_at` 保留 backward compatibility，新的 operational health 以 `source_health` 為準。

## Ingestion paths

1. `scripts/update_reports.py`：直接讀官方 public research pages；direct path 對 robots.txt 採 fail-closed。若直接抓 robots transport 失敗，可透過 reader 讀取**同一份官方 robots.txt 規則**；仍只有明確 ALLOW 才會 direct crawl。
2. `scripts/update_reader_fallback.py`：針對 hosted runner 不穩定的 publisher front door，透過 reader transport 取得 public landing-page metadata；canonical URL 仍保持 publisher 官方 URL。
3. `sitemap_sources`：只做 live discovery/heartbeat。McKinsey official sitemap 透過 reader transport 取得後，只把「已驗證 report URL 是否仍出現在官方 sitemap」計入 live observation；未知 URL 只列為 unverified candidate，不會在沒有可信日期時寫進 reports。
4. McKinsey `verified-seed`：只保存人工核對過的 official title/date/URL metadata，並明確標 provenance；seed 不算 live observation。缺少的 verified seed 可以 backfill，但不會每天重寫或冒充 live article fetch。

Fallback description 只取目前 card link 後、下一個 link 前的 bounded metadata；若無法取得乾淨摘要，寧可留空，不把 asset URL 或相鄰 card 內容當 description。

## Quality gate

Content hard gate：四家公司各 ≥ 3 dated records、undated rows = 0、duplicate URLs = 0、最新 publication ≤ 60 days、SQLite integrity = ok。

Operational gate：

- `healthy`：本輪至少有一個該公司的 configured discovery transport 成功重新觀測到有效 records / 已驗證 official URLs
- `degraded`：本輪無 live observation，但尚未超過連續空抓上限；可發布 cached validated content
- `fail`：該公司所有 configured sources 已達連續空抓上限；production audit fail

因此 `healthy` 是「至少一條 live discovery surface 正常」，**不是**「所有 publisher article HTML 都可下載」。每個 transport 的細節仍保留在 `source_health.json`。

## Elephant integration contract

Elephant 應先讀 `data/manifest.json`，驗證 `schema_version`、`contract == "research-context-only"`、`score_influence == false`、`overall_health` 與 artifact SHA-256。

顧問研究可以成為 Elephant 的 Evidence / Contradictions / Risks / strategy context，**不允許改變 deterministic economic score**。

## Website

GitHub Pages 直接以 sql.js / WebAssembly 載入 `consultant.db`，提供 keyword/filter、Content freshness + Ingestion health dashboard、Table/Card view、artifact downloads 與 browser-memory SQL sandbox。

## Tests

```bash
python -m unittest discover -s tests -v
python scripts/audit_coverage.py
python scripts/build_sqlite.py
python scripts/build_manifest.py
node --check site/app.js
```

Regression tests覆蓋相鄰 card contamination、asset noise、relative reader links、sitemap namespace filtering、robots reader fallback、短字 keyword boundary、publication-date precedence、ingestion health escalation。

## Data policy

只保存公開 metadata、provenance 與 operational health。不鏡像付費或受版權保護全文。任何重大決策仍應回官方原始頁面與第一手數據核對。
