# Consultant System

一個以公開顧問研究為來源的個人研究知識庫。

目前涵蓋：

- McKinsey & Company
- Boston Consulting Group (BCG)
- Deloitte
- PwC

## 目標

這個 repository 不鏡像顧問公司的全文內容，而是保存：

1. 官方來源入口
2. 報告 / 研究的 metadata
3. 自己整理的摘要、關鍵結論與反證條件
4. 可被 GitHub Search、Codex、ChatGPT 直接檢索的 Markdown
5. 機器可讀的 `catalog/sources.csv`

這樣做的核心目標是：**低維護成本、可追溯來源、方便 AI 查詢。**

## Repository 結構

```text
Consultant_System/
├─ README.md
├─ AGENTS.md
├─ catalog/
│  └─ sources.csv
├─ docs/
│  └─ QUERY_GUIDE.md
├─ sources/
│  ├─ mckinsey.md
│  ├─ bcg.md
│  ├─ deloitte.md
│  └─ pwc.md
└─ knowledge/
   └─ README.md
```

## 快速查詢

### GitHub

可搜尋：

```text
AI
semiconductor
power electronics
energy
manufacturing
supply chain
macroeconomics
Taiwan
```

### 對 AI 下指令

```text
請搜尋這個 repo 中與 AI、半導體、能源、製造業有關的顧問研究。
優先官方來源與 2025-2026 的內容。
輸出：已知事實、顧問觀點、我的推論、待驗證項目、原始來源。
```

或：

```text
比較 McKinsey、BCG、Deloitte、PwC 對 AI 企業導入的觀點，
列出共識、分歧、數據證據與來源日期。
```

## 收錄原則

- 優先官方網站與第一手報告。
- 不把顧問公司的付費 / 受版權保護全文直接複製進 repo。
- 保存 URL、標題、日期、類型、主題、摘要、重要數據與自己的分析。
- 重要數字必須能追溯到原始來源。
- 過期研究不要刪除，但標記日期，避免把歷史觀點當成現況。

## 初始狀態

2026-08-09 建立第一版骨架，先放入四家顧問公司的官方研究入口，其中 McKinsey 收錄較完整的公開研究分類。
