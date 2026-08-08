# AGENTS.md

本 repository 是公開顧問研究的可檢索知識庫。

## 查詢優先順序

1. 先搜尋 `catalog/sources.csv` 找官方入口與主題。
2. 再搜尋 `sources/*.md` 了解各顧問公司的研究分類。
3. 最後搜尋 `knowledge/` 中已整理的單篇研究筆記。

## 回答規則

查詢本 repo 時，優先輸出：

1. 已知事實
2. 顧問公司的原始觀點
3. 合理推論
4. 待驗證項目
5. 原始 URL 與日期

不要把顧問公司的推估值描述成確定事實。
不要把舊報告當成目前狀況；先檢查 publication_date / last_checked。
如果多家顧問公司對同一主題有不同結論，保留差異，不要強行平均。

## 新增研究筆記格式

每篇研究建議建立成：

```text
knowledge/YYYY/YYYY-MM-DD-firm-topic-slug.md
```

Markdown front matter：

```yaml
---
firm: McKinsey
source_type: report
publication_date: 2026-01-01
last_checked: 2026-08-09
topics:
  - AI
  - manufacturing
regions:
  - global
url: https://example.com
---
```

正文至少包含：

- 一句話結論
- 已知事實 / 數據
- 顧問觀點
- 假設與方法
- 可能反例 / 限制
- 對決策的意義
- 原始來源

## 版權與資料邊界

除非來源明確允許再散布，不要直接保存完整文章或完整 PDF 文字。
以官方 URL、metadata、短摘錄、自己的摘要與分析為主。
