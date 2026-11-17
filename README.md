# 林相攝影排班系統 - Vercel 部署說明

## 檔案結構
```
linxiang-schedule/
├── index.html        # 排班系統主體
├── api/
│   └── shifts.js     # 讀寫班表的 API（需員工密碼）
├── test/
│   └── shifts.test.mjs
├── vercel.json       # Vercel 設定
└── README.md
```

## 部署步驟

### 第一步：上傳到 GitHub
1. 在 GitHub 建立新 repo（例如 `linxiang-schedule`）
2. 把這個資料夾的檔案上傳進去

### 第二步：在 Vercel 部署
1. 到 https://vercel.com 登入
2. 點「Add New Project」
3. 匯入你剛建立的 GitHub repo
4. 直接點「Deploy」

### 第三步：建立 KV 資料庫
1. 在 Vercel 專案頁面，點上方「Storage」
2. 點「Create Database」→ 選「KV」
3. 名稱輸入 `linxiang-kv`，點「Create」
4. 建立後，點「Connect to Project」連接你的專案
5. 點「Redeploy」重新部署

### 第四步：設定員工密碼（上線前必做）
1. 在 Vercel 專案頁面，點「Settings」→「Environment Variables」
2. 新增一筆環境變數
   - 名稱：`SCHEDULE_PASSWORD`
   - 值：自訂一組員工共用密碼
3. 存檔後再按一次「Redeploy」

沒有設定 `SCHEDULE_PASSWORD` 時，班表會鎖住，不能看也不能改。這是為了避免外人看到員工姓名和班表。

### 完成！
- 員工填完班表按送出 → 自動存到雲端
- 老闆進管理者模式 → 自動載入所有人最新班表
- 換設備或換瀏覽器 → 資料還在

## 注意事項
- Vercel KV 免費方案：30MB 儲存、30萬次讀取/月
- 對林相攝影這個規模完全夠用
- 員工密碼是 Vercel 環境變數 `SCHEDULE_PASSWORD`，不要寫進程式碼。登入後才能看班表、填班和改公告。
- 管理者密碼：1234（可在 index.html 裡修改 ADMIN_PW）。這是登入之後，「老闆 / 管理者」按鈕用的密碼，和員工密碼是分開的。
