# Knowledge Notes

這個目錄存放「單篇公開研究」的結構化筆記，不保存未經允許的完整原文。

## 檔名

```text
YYYY/YYYY-MM-DD-firm-topic-slug.md
```

例如：

```text
2026/2026-06-29-mckinsey-global-economics-intelligence.md
```

## Template

```markdown
---
firm: McKinsey
source_type: report
publication_date: YYYY-MM-DD
last_checked: YYYY-MM-DD
topics:
  - AI
regions:
  - global
url: https://official-source.example
---

# Title

## 一句話結論

## 已知事實 / 數據

## 顧問觀點

## 方法 / 假設

## 限制 / 可能反例

## 對決策的意義

## 待驗證項目

## 原始來源
```

## 原則

- 摘要使用自己的文字。
- 數字要保留單位、年份、地區、樣本與口徑。
- 預測值明確標示 forecast / estimate。
- Survey 明確標示受訪者類型，不把意見調查當成客觀財務結果。
- 若原始 URL 失效，保留舊 URL 並更新 `last_checked` 與狀態。
