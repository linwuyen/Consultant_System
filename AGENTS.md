# AGENTS.md

本 repository 是公開顧問研究的 **evidence discovery + ingestion health layer**。

## Production query order

1. 先讀 `data/manifest.json`：確認 schema、overall health、各公司 ingestion status。
2. 查 `data/consultant.db` 或 `data/reports.json`：取得 production research records。
3. `knowledge/`：只在已有人工/結構化 evidence note 時使用。
4. `sources/*.md` 與 `catalog/`：僅提供 publisher context / 人工 discovery，不是 production source of truth。

## Canonical config

`config/sources.json` 是 crawler sources、fallback sources、health policy 與 topic keyword 的唯一 production canonical configuration。

## 回答規則

優先輸出：已知事實、顧問公司的原始觀點、合理推論、待驗證項目、publication date / provenance / 原始 URL。

不要：

- 把顧問公司的 forecast 當確定事實。
- 把 metadata description 當已驗證 evidence。
- 把 survey perception 當 audited performance。
- 把 `reports.json.updated_at` 當 crawler health；operational health 看 `source_health` / `manifest`。
- 在 ingestion `degraded` / `fail` 時假裝 coverage 正常。

## Knowledge note contract

`knowledge/YYYY/YYYY-MM-DD-firm-topic-slug.md` 至少包含：一句話結論、已知事實/數據、顧問觀點、方法/假設、限制/反例、對決策意義、待驗證項目、原始來源。

## 版權與 evidence boundary

除非來源明確允許再散布，不保存完整文章或完整 PDF 文字。以官方 URL、metadata、短摘錄與自己的分析為主。投資、產業與重大決策必須回原始來源與第一手資料核對。
