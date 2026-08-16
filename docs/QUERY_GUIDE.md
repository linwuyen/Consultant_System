# Query Guide

## 1. 先確認 snapshot 是否可信

先看 `data/manifest.json`：schema、overall health、各公司 ingestion status、artifact hash。

若某公司 `degraded`，可使用 cached records，但回答中應標示 live ingestion 異常；若 `fail`，不要把該公司的 coverage 描述為正常。

## 2. 查 production records

優先查 `data/consultant.db` 或 `data/reports.json`。`catalog/` 與 `sources/*.md` 是人工 discovery/context，不是最新 production records。

查詢時把以下欄位一起帶出：company、title、published_at/date、url、description、published_at_source、observation_mode。

## 3. Evidence 升級

metadata record 只代表「發現了一篇研究」，不代表其主張已被驗證。只有需要進入決策 thesis 的報告才建立 `knowledge/` note，並拆成：已知事實、顧問觀點、forecast、方法、樣本、限制、反證與待驗證項目。

## 4. 重大決策

投資、財務與快速變化主題必須回原始 publisher page，並優先再用公司財報、政府統計或其他第一手資料驗證。
