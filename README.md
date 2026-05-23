# Teachable Machine Pose Battle Demo

這個版本已調整成前後端分離部署：

- 前端：GitHub Pages
- 後端 API：Render

學員可以：

- 各自貼上自己的 Google Teachable Machine Pose 模型 URL
- 選擇自己的攻擊姿勢標籤
- 輸入相同房間號碼後加入同一場對戰
- 透過瀏覽器鏡頭做姿勢辨識
- 當攻擊姿勢達到門檻時對對手造成傷害

## 本地開發

```bash
npm start
```

啟動後開啟：

```text
http://127.0.0.1:3000
```

本地模式下，前端會直接使用同源 API。

## GitHub Pages 前端產出

先設定 Render API 網址，再產出 `docs/`：

```bash
PUBLIC_API_BASE_URL=https://your-render-service.onrender.com npm run build:pages
```

執行後會：

- 把 `public/` 複製到 `docs/`
- 自動產生 `docs/config.js`
- 自動建立 `docs/.nojekyll`

之後把整個專案推上 GitHub，並在 GitHub Pages 設定：

- Source: `Deploy from a branch`
- Branch: 你的分支
- Folder: `/docs`

## Render 後端部署

專案已附上 [render.yaml](/Users/linkaiyu/Documents/Web/TeachableMechineProject/render.yaml)。

在 Render 建立 Web Service 時：

1. 連接這個 GitHub repo
2. Render 會讀到 `render.yaml`
3. 設定環境變數 `ALLOWED_ORIGINS`

範例：

```text
ALLOWED_ORIGINS=https://your-name.github.io
```

如果你是 GitHub 專案頁面而不是使用者首頁，通常也還是同一個 origin，例如：

```text
https://your-name.github.io
```

注意這裡填的是 origin，不要加路徑尾巴。

## 模型 URL 格式

請輸入匯出的模型資料夾 URL，例如：

```text
https://teachablemachine.withgoogle.com/models/your-model-id/
```

系統會自動讀取：

- `model.json`
- `metadata.json`

## 對戰規則

- 每位玩家初始 HP 為 100
- 雙方都成功加入房間並選定攻擊姿勢後，自動開始對戰
- 當玩家做出自己選定的姿勢，且信心值高於門檻時，會觸發一次攻擊
- 每次攻擊造成 10 點傷害
- 為避免連續誤判，每位玩家有 1.2 秒攻擊冷卻

## 重要限制

- 目前房間資料仍存在記憶體中
- Render 免費方案休眠後，第一位使用者可能要等幾秒喚醒服務
- 伺服器重啟後，既有房間資料會清空

## 部署後檢查

部署後請確認兩件事：

1. GitHub Pages 的 `config.js` 裡 API 網址是你的 Render 網址
2. Render 的 `ALLOWED_ORIGINS` 有填入你的 GitHub Pages origin
