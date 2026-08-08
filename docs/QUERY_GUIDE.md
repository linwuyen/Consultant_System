# Query Guide

這個 repo 的查詢策略是先用低成本文字搜尋，再讓 AI 做跨來源比較。

## 1. GitHub / Codex 搜尋順序

先查：

```text
catalog/sources.csv
sources/
knowledge/
```

若查「AI + 製造業」：

```text
AI manufacturing
AI industrial
AI factory
AI productivity
```

若查「半導體 / 電源 / 資料中心」：

```text
semiconductor
advanced electronics
power electronics
energy storage
data center power
power infrastructure
```

## 2. 推薦 AI Prompt

### 單一主題

```text
在 Consultant_System 中搜尋「semiconductor」。
先列出命中的顧問公司與來源日期，再整理：
1. 已知事實
2. 顧問觀點
3. 關鍵數據
4. 假設 / 方法
5. 可能反例
6. 對台灣產業的可能意義
7. 原始 URL
```

### 四家交叉比較

```text
搜尋 McKinsey、BCG、Deloitte、PwC 對 enterprise AI 的公開研究。
只使用 repo 內有來源 URL 的資料。
比較共識、分歧、資料年份、樣本與可驗證性。
不要把 survey perception 當成企業實際績效。
```

### 投資研究

```text
找出與 semiconductor / data center / power infrastructure 有關的顧問研究。
把「事實、顧問推估、我的投資假設」分開。
指出哪些數據需要再用公司財報、政府統計或產業資料驗證。
```

## 3. 新資料加入流程

每看到值得保存的公開報告：

1. 記錄官方 URL。
2. 建立 `knowledge/YYYY/YYYY-MM-DD-firm-topic.md`。
3. 填寫 publication_date、last_checked、topics、regions。
4. 用自己的文字整理結論。
5. 重要數字註明來源與口徑。
6. 有預測值時寫出基準年、預測年、假設。
7. 如為 survey，保存樣本數、對象與調查期間。

## 4. 何時不相信摘要

遇到以下情況必須回原文：

- 投資 / 財務重大決策
- 數字口徑不明
- 報告超過 2 年且主題快速變動
- AI、半導體、能源價格等快速變化領域
- 不同顧問公司結論互相矛盾
- 二手媒體引用顧問數字但沒有原始報告

## 5. 最小維護原則

不要一開始建立向量資料庫、RAG server 或自動爬蟲。
先累積 50-100 篇高品質、結構化 Markdown；只有當 GitHub / AI 搜尋開始明顯找不到東西時，再升級索引架構。
