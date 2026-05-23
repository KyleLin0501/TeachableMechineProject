# Pose Dino Party

這個專案是一個多人連線的 Teachable Machine Pose 小恐龍遊戲：

- 玩家：設定暱稱、選房間、載入自己的 Pose 模型、測試鏡頭、選定跳躍姿勢後加入等待室
- 主持人：加入同一個房間後，從後台同步啟動回合、查看所有玩家結果、進行頒獎
- 每回合：所有玩家在各自視窗內跑同一套障礙賽道，碰撞即淘汰
- 多回合：保留最佳分數、累積總分、冠軍次數與歷史回合成績

## 技術架構

- 前端：GitHub Pages 靜態站
- 後端：Render Web Service
- Pose 推論：在玩家瀏覽器端執行
- 房間與回合同步：Node.js 記憶體 API

## 本地開發

```bash
npm start
```

打開：

```text
http://127.0.0.1:3000
```

## GitHub Pages 產出

先把 Render API 網址帶入，再產出 `docs/`：

```bash
PUBLIC_API_BASE_URL=https://your-render-service.onrender.com npm run build:pages
```

產出後：

- `docs/index.html`
- `docs/app.js`
- `docs/style.css`
- `docs/config.js`

會直接作為 GitHub Pages 內容。

## Render 後端設定

專案根目錄包含 [render.yaml](/Users/linkaiyu/Documents/Web/TeachableMechineProject/render.yaml)。

必要環境變數：

```text
ALLOWED_ORIGINS=https://yourname.github.io
```

如果你的 GitHub Pages 網址是：

```text
https://yourname.github.io/TeachableMechineProject/
```

`ALLOWED_ORIGINS` 仍然填：

```text
https://yourname.github.io
```

## 玩家流程

1. 選擇 `玩家`
2. 輸入暱稱與房間號碼
3. 貼上 Teachable Machine Pose 模型 URL
4. 載入模型
5. 啟動鏡頭並測試
6. 選好跳躍姿勢
7. 進入等待房間

## 主持人流程

1. 選擇 `主持人`
2. 輸入暱稱與房間號碼
3. 加入主持後台
4. 等待玩家就緒
5. 按下 `啟動回合`
6. 回合結束後查看排行榜與歷史紀錄

## 目前限制

- 房間狀態目前存在記憶體中，Render 重啟後會清空
- Render Free 方案可能會休眠，第一位使用者需要等待喚醒
- 主持人與玩家角色建議分開用不同瀏覽器視窗或不同裝置操作
