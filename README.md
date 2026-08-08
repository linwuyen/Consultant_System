# Consultant System

自動更新的顧問研究資料庫與 GitHub Pages 網站，追蹤：

- McKinsey & Company
- Boston Consulting Group (BCG)
- Deloitte
- PwC

## Website

**Consultant System：** https://linwuyen.github.io/Consultant_System/

## 架構

```text
官方公開研究頁
      ↓
scripts/update_reports.py
      ↓
data/reports.json + reports.csv
      ↓
GitHub Pages 靜態網站
```

GitHub Actions 每天 09:17（Asia/Taipei）自動更新一次，也可手動執行 `Update consultant database` workflow。

## 網站功能

- 關鍵字搜尋
- 公司篩選
- 主題篩選
- 年份篩選
- 日期排序
- 原始官方來源連結
- JSON / CSV 資料匯出

## 資料政策

本 repository **不鏡像顧問公司的全文**，只保存公開頁面的：

- 標題
- 發布日期（若官方頁面可取得）
- 摘要 / meta description
- 公司
- 主題標籤
- 原始 URL
- 發現時間與最後確認時間

更新器會讀取各站 `robots.txt`，被禁止抓取的頁面會略過。任何數字與結論仍應回到原始來源驗證。

## 主要檔案

```text
config/sources.json              # 來源與主題關鍵字
scripts/update_reports.py        # metadata 更新器
data/reports.json                # 網站主要資料庫
data/reports.csv                 # CSV 匯出
site/                            # 無框架靜態前端
.github/workflows/update-reports.yml
.github/workflows/pages.yml
```

## 本機測試

```bash
pip install -r requirements.txt
python scripts/update_reports.py
```

若要模擬 GitHub Pages：

```bash
rm -rf _site
mkdir -p _site/data
cp -R site/. _site/
cp data/reports.json data/reports.csv _site/data/
python -m http.server 8000 --directory _site
```

## GitHub Pages

GitHub Pages 使用官方 deployment actions 部署，正式網站：

https://linwuyen.github.io/Consultant_System/
