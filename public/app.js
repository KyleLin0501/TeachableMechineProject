const PLAYER_STORAGE_KEY = "pose_dino_party_participant_id";
const fallbackParticipantId = crypto.randomUUID();

const state = {
  participantId: sessionStorage.getItem(PLAYER_STORAGE_KEY) || fallbackParticipantId,
  apiBaseUrl: resolveApiBaseUrl(),
  role: "player",
  nickname: "",
  roomId: "",
  modelUrl: "",
  modelName: "",
  model: null,
  webcam: null,
  maxPredictions: 0,
  labels: [],
  selectedLabel: "",
  threshold: 0.86,
  cameraReady: false,
  joined: false,
  latestRoom: null,
  pollTimer: null,
  syncTimer: null,
  animationStarted: false,
  predictBusy: false,
  currentPose: "",
  currentConfidence: 0,
  poseArmed: false,
  serverOffsetMs: 0,
  localGame: createLocalGameState(),
};

sessionStorage.setItem(PLAYER_STORAGE_KEY, state.participantId);

const els = {
  roleSelect: document.getElementById("roleSelect"),
  nicknameInput: document.getElementById("nicknameInput"),
  roomInput: document.getElementById("roomInput"),
  modelUrlInput: document.getElementById("modelUrlInput"),
  labelSelect: document.getElementById("labelSelect"),
  thresholdInput: document.getElementById("thresholdInput"),
  thresholdValue: document.getElementById("thresholdValue"),
  loadModelButton: document.getElementById("loadModelButton"),
  cameraButton: document.getElementById("cameraButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  leaveHintButton: document.getElementById("leaveHintButton"),
  apiBaseUrlText: document.getElementById("apiBaseUrlText"),
  cameraReadyText: document.getElementById("cameraReadyText"),
  statusText: document.getElementById("statusText"),
  roomStatusText: document.getElementById("roomStatusText"),
  phaseText: document.getElementById("phaseText"),
  roundText: document.getElementById("roundText"),
  countdownBanner: document.getElementById("countdownBanner"),
  currentPoseChip: document.getElementById("currentPoseChip"),
  currentPoseText: document.getElementById("currentPoseText"),
  currentConfidenceText: document.getElementById("currentConfidenceText"),
  selectedPoseText: document.getElementById("selectedPoseText"),
  playerStateText: document.getElementById("playerStateText"),
  gameStatusText: document.getElementById("gameStatusText"),
  myScoreText: document.getElementById("myScoreText"),
  bestScoreText: document.getElementById("bestScoreText"),
  totalScoreText: document.getElementById("totalScoreText"),
  winsText: document.getElementById("winsText"),
  winnerText: document.getElementById("winnerText"),
  leaderboardList: document.getElementById("leaderboardList"),
  historyList: document.getElementById("historyList"),
  eventLog: document.getElementById("eventLog"),
  hostPanel: document.getElementById("hostPanel"),
  startRoundButton: document.getElementById("startRoundButton"),
  resetLeaderboardButton: document.getElementById("resetLeaderboardButton"),
  hostSummaryText: document.getElementById("hostSummaryText"),
  cameraCanvas: document.getElementById("cameraCanvas"),
  gameCanvas: document.getElementById("gameCanvas"),
};

const cameraCtx = els.cameraCanvas.getContext("2d");
const gameCtx = els.gameCanvas.getContext("2d");

function createLocalGameState() {
  return {
    roundNumber: 0,
    seed: null,
    startAt: null,
    status: "idle",
    score: 0,
    reportedDeath: false,
    obstacles: [],
    dino: {
      x: 92,
      y: 0,
      vy: 0,
      width: 42,
      height: 46,
    },
    physics: {
      jumpVelocity: 540,
      gravity: 1450,
      groundY: 230,
    },
  };
}

function resolveApiBaseUrl() {
  const rawValue =
    window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE_URL === "string"
      ? window.APP_CONFIG.API_BASE_URL
      : "";

  return rawValue.trim().replace(/\/+$/, "");
}

function getApiUrl(path) {
  return `${state.apiBaseUrl}${path}`;
}

function getServerNow() {
  return Date.now() + state.serverOffsetMs;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function normalizeModelBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    throw new Error("請先輸入模型 URL");
  }

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function updateThreshold() {
  state.threshold = Number(els.thresholdInput.value);
  els.thresholdValue.textContent = state.threshold.toFixed(2);
}

function updateRoleUI() {
  state.role = els.roleSelect.value === "host" ? "host" : "player";
  document.body.classList.toggle("role-host", state.role === "host");
  els.joinRoomButton.textContent = state.role === "host" ? "加入主持後台" : "3. 進入等待房間";
  els.cameraReadyText.textContent = state.role === "host" ? "主持人無需鏡頭" : state.cameraReady ? "鏡頭測試完成" : "未啟動";
  refreshActionButtons();
  renderCameraPlaceholder();
}

function refreshActionButtons() {
  const hasRoomFields = Boolean(els.nicknameInput.value.trim() && els.roomInput.value.trim());
  const playerReady = Boolean(state.model && state.cameraReady && state.selectedLabel);

  els.loadModelButton.disabled = state.role === "host";
  els.cameraButton.disabled = state.role === "host" || !state.model;
  els.joinRoomButton.disabled = state.role === "host" ? !hasRoomFields : !(hasRoomFields && playerReady);
  els.leaveHintButton.disabled = !state.joined;
}

function populateLabels(labels) {
  els.labelSelect.innerHTML = "";

  if (!labels.length) {
    els.labelSelect.innerHTML = '<option value="">沒有找到標籤</option>';
    els.labelSelect.disabled = true;
    return;
  }

  labels.forEach((label, index) => {
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    if (index === 0) {
      option.selected = true;
      state.selectedLabel = label;
    }
    els.labelSelect.appendChild(option);
  });

  els.labelSelect.disabled = false;
  els.selectedPoseText.textContent = state.selectedLabel || "-";
}

async function api(path, options = {}) {
  const response = await fetch(getApiUrl(path), {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function loadModel() {
  try {
    const baseUrl = normalizeModelBaseUrl(els.modelUrlInput.value);
    setStatus("模型載入中...");

    const modelURL = `${baseUrl}model.json`;
    const metadataURL = `${baseUrl}metadata.json`;
    const model = await tmPose.load(modelURL, metadataURL);

    state.model = model;
    state.modelUrl = baseUrl;
    state.maxPredictions = model.getTotalClasses();
    state.labels = Array.from({ length: state.maxPredictions }, (_, index) => model.getClassLabels()[index]);
    state.modelName = new URL(baseUrl).pathname.split("/").filter(Boolean).pop() || "Pose Model";

    populateLabels(state.labels);
    refreshActionButtons();
    setStatus(`模型載入完成，共 ${state.labels.length} 個標籤`);
  } catch (error) {
    console.error(error);
    setStatus(`模型載入失敗：${error.message}`);
  }
}

async function startCamera() {
  try {
    if (!state.model) {
      throw new Error("請先載入模型");
    }

    setStatus("鏡頭啟動中...");
    state.webcam = new tmPose.Webcam(480, 360, true);
    await state.webcam.setup();
    await state.webcam.play();

    state.cameraReady = true;
    els.cameraReadyText.textContent = "鏡頭測試完成";
    refreshActionButtons();
    setStatus("鏡頭已啟動，請測試跳躍姿勢是否能被辨識");
    startAnimationLoop();
  } catch (error) {
    console.error(error);
    state.cameraReady = false;
    els.cameraReadyText.textContent = "鏡頭啟動失敗";
    setStatus(`鏡頭啟動失敗：${error.message}`);
    refreshActionButtons();
  }
}

function startAnimationLoop() {
  if (state.animationStarted) {
    return;
  }

  state.animationStarted = true;
  let lastFrameAt = performance.now();

  const loop = (frameAt) => {
    const deltaMs = frameAt - lastFrameAt;
    lastFrameAt = frameAt;

    if (state.webcam && state.model && !state.predictBusy && state.role === "player") {
      state.predictBusy = true;
      runPosePrediction().finally(() => {
        state.predictBusy = false;
      });
    } else if (!state.webcam) {
      renderCameraPlaceholder();
    }

    updateLocalGame(deltaMs);
    renderGame();
    window.requestAnimationFrame(loop);
  };

  renderCameraPlaceholder();
  renderGame();
  window.requestAnimationFrame(loop);
}

async function runPosePrediction() {
  if (!state.webcam || !state.model) {
    return;
  }

  state.webcam.update();
  const { pose, posenetOutput } = await state.model.estimatePose(state.webcam.canvas);
  const predictions = await state.model.predict(posenetOutput);
  const bestPrediction = predictions.reduce((top, item) => {
    return item.probability > top.probability ? item : top;
  }, predictions[0]);

  state.currentPose = bestPrediction.className;
  state.currentConfidence = bestPrediction.probability;

  els.currentPoseText.textContent = state.currentPose || "未辨識";
  els.currentConfidenceText.textContent = state.currentConfidence.toFixed(2);
  els.currentPoseChip.textContent = state.currentPose || "辨識中";

  drawCamera(pose);
  maybeTriggerJump();
}

function drawCamera(pose) {
  if (!state.webcam) {
    renderCameraPlaceholder();
    return;
  }

  cameraCtx.clearRect(0, 0, els.cameraCanvas.width, els.cameraCanvas.height);
  cameraCtx.drawImage(state.webcam.canvas, 0, 0, els.cameraCanvas.width, els.cameraCanvas.height);

  if (pose) {
    tmPose.drawKeypoints(pose.keypoints, 0.45, cameraCtx);
    tmPose.drawSkeleton(pose.keypoints, 0.45, cameraCtx);
  }
}

function renderCameraPlaceholder() {
  cameraCtx.clearRect(0, 0, els.cameraCanvas.width, els.cameraCanvas.height);
  cameraCtx.fillStyle = "#edf7ff";
  cameraCtx.fillRect(0, 0, els.cameraCanvas.width, els.cameraCanvas.height);
  cameraCtx.fillStyle = "#1b3554";
  cameraCtx.font = "700 24px Avenir Next";
  cameraCtx.fillText(state.role === "host" ? "主持人模式" : "等待鏡頭啟動", 28, 44);
  cameraCtx.fillStyle = "#6b7a90";
  cameraCtx.font = "16px Avenir Next";
  cameraCtx.fillText(
    state.role === "host"
      ? "這個視窗保留給主持後台，玩家請在另一個瀏覽器視窗加入房間。"
      : "完成模型載入與鏡頭測試後，就能進入等待房間。",
    28,
    74
  );
}

function maybeTriggerJump() {
  if (state.role !== "player" || !state.joined) {
    return;
  }

  const game = state.localGame;
  const isJumpPose =
    state.currentPose === state.selectedLabel &&
    state.currentConfidence >= state.threshold &&
    game.status === "running";

  if (isJumpPose && !state.poseArmed) {
    state.poseArmed = true;
    triggerJump();
  } else if (!isJumpPose) {
    state.poseArmed = false;
  }
}

function triggerJump() {
  const game = state.localGame;
  if (game.status !== "running") {
    return;
  }

  const { dino, physics } = game;
  if (dino.y === 0) {
    dino.vy = physics.jumpVelocity;
  }
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }

  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function createObstacleTimeline(seed) {
  const random = seededRandom(seed);
  const obstacles = [];
  let spawnAt = 1400;

  while (spawnAt < 95_000) {
    const width = 18 + Math.floor(random() * 22);
    const height = 28 + Math.floor(random() * 52);
    obstacles.push({
      spawnAt,
      width,
      height,
    });
    spawnAt += 1150 + Math.floor(random() * 1400);
  }

  return obstacles;
}

function prepareRound(room) {
  const round = room.round;

  if (!round.seed || round.number === 0) {
    return;
  }

  if (state.localGame.roundNumber === round.number && state.localGame.seed === round.seed) {
    return;
  }

  state.localGame = createLocalGameState();
  state.localGame.roundNumber = round.number;
  state.localGame.seed = round.seed;
  state.localGame.startAt = round.startAt;
  state.localGame.obstacles = createObstacleTimeline(round.seed);
  state.localGame.status = room.phase === "countdown" ? "countdown" : room.phase === "running" ? "running" : "idle";
}

function getMyParticipant() {
  return state.latestRoom ? state.latestRoom.me : null;
}

function isMeActiveInCurrentRound() {
  const me = getMyParticipant();
  const room = state.latestRoom;
  return Boolean(me && room && room.round.activeParticipantIds.includes(me.id));
}

function updateLocalGame(deltaMs) {
  const room = state.latestRoom;
  const me = getMyParticipant();

  if (!room || !me || state.role !== "player") {
    drawIdleGame("主持人可從右側後台啟動回合");
    return;
  }

  prepareRound(room);

  if (!isMeActiveInCurrentRound()) {
    state.localGame.status = "idle";
    drawIdleGame("等待主持人將你納入下一回合");
    return;
  }

  if (room.phase === "countdown") {
    state.localGame.status = "countdown";
    drawIdleGame("倒數中，準備起跑");
    return;
  }

  if (room.phase === "results") {
    if (state.localGame.status !== "dead") {
      state.localGame.status = "results";
    }
    return;
  }

  if (room.phase !== "running") {
    state.localGame.status = "idle";
    return;
  }

  if (state.localGame.status === "countdown") {
    state.localGame.status = "running";
  }

  if (state.localGame.status !== "running") {
    return;
  }

  const elapsedMs = Math.max(0, getServerNow() - state.localGame.startAt);
  const dt = Math.min(deltaMs, 32) / 1000;
  const dino = state.localGame.dino;
  const physics = state.localGame.physics;

  dino.y = Math.max(0, dino.y + dino.vy * dt);
  dino.vy -= physics.gravity * dt;

  if (dino.y <= 0) {
    dino.y = 0;
    dino.vy = Math.max(0, dino.vy);
  }

  state.localGame.score = Math.floor(elapsedMs / 45);

  if (detectCollision(elapsedMs)) {
    handleLocalDeath();
  }
}

function detectCollision(elapsedMs) {
  const dinoRect = getDinoRect();

  return state.localGame.obstacles.some((obstacle) => {
    const obstacleRect = getObstacleRect(obstacle, elapsedMs);
    if (!obstacleRect) {
      return false;
    }

    return !(
      dinoRect.x + dinoRect.width < obstacleRect.x ||
      dinoRect.x > obstacleRect.x + obstacleRect.width ||
      dinoRect.y + dinoRect.height < obstacleRect.y ||
      dinoRect.y > obstacleRect.y + obstacleRect.height
    );
  });
}

function getDinoRect() {
  const { dino, physics } = state.localGame;
  return {
    x: dino.x,
    y: physics.groundY - dino.height - dino.y,
    width: dino.width,
    height: dino.height,
  };
}

function getObstacleRect(obstacle, elapsedMs) {
  const speed = 300;
  const timeSinceSpawn = elapsedMs - obstacle.spawnAt;

  if (timeSinceSpawn < -1000) {
    return null;
  }

  const x = els.gameCanvas.width + 40 - (timeSinceSpawn / 1000) * speed;
  if (x < -80 || x > els.gameCanvas.width + 80) {
    return null;
  }

  return {
    x,
    y: state.localGame.physics.groundY - obstacle.height,
    width: obstacle.width,
    height: obstacle.height,
  };
}

function handleLocalDeath() {
  if (state.localGame.reportedDeath) {
    return;
  }

  state.localGame.status = "dead";
  state.localGame.reportedDeath = true;
  state.poseArmed = false;

  syncPresence(true).catch((error) => {
    console.error(error);
  });
}

function drawIdleGame(message) {
  gameCtx.clearRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  gameCtx.fillStyle = "#eef8ff";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  drawGround();

  gameCtx.fillStyle = "#1c3556";
  gameCtx.font = "700 28px Avenir Next";
  gameCtx.fillText("Pose Dino Party", 36, 56);
  gameCtx.fillStyle = "#64748b";
  gameCtx.font = "18px Avenir Next";
  gameCtx.fillText(message, 36, 88);
}

function drawGround() {
  gameCtx.fillStyle = "#d6b85d";
  gameCtx.fillRect(0, state.localGame.physics.groundY + 4, els.gameCanvas.width, 4);
  gameCtx.fillStyle = "#f7c76d";
  gameCtx.fillRect(0, state.localGame.physics.groundY + 8, els.gameCanvas.width, 10);
}

function renderGame() {
  const room = state.latestRoom;
  const me = getMyParticipant();
  const game = state.localGame;

  gameCtx.clearRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  gameCtx.fillStyle = "#eef8ff";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  drawClouds();
  drawGround();

  if (!room || !me || state.role !== "player" || !isMeActiveInCurrentRound()) {
    drawIdleGame(state.role === "host" ? "主持人不用跑道，可直接操作右側後台。" : "進入等待房間後，主持人開始回合才會出現賽道。");
    updateGameMetrics();
    return;
  }

  const elapsedMs = Math.max(0, getServerNow() - game.startAt);
  drawObstacles(elapsedMs);
  drawDino();

  if (game.status === "countdown") {
    drawOverlay("準備起跑", "主持人已同步倒數");
  } else if (game.status === "dead") {
    drawOverlay("本回合淘汰", `你的分數 ${game.score}`);
  } else if (room.phase === "results") {
    drawOverlay("回合結束", `你的分數 ${game.score}`);
  }

  updateGameMetrics();
}

function drawClouds() {
  gameCtx.fillStyle = "rgba(255,255,255,0.85)";
  [
    [110, 62, 28],
    [310, 36, 20],
    [640, 54, 26],
  ].forEach(([x, y, size]) => {
    gameCtx.beginPath();
    gameCtx.arc(x, y, size, 0, Math.PI * 2);
    gameCtx.arc(x + size * 0.9, y + 6, size * 0.8, 0, Math.PI * 2);
    gameCtx.arc(x + size * 1.6, y, size * 0.7, 0, Math.PI * 2);
    gameCtx.fill();
  });
}

function drawObstacles(elapsedMs) {
  gameCtx.fillStyle = "#3e6a4c";
  state.localGame.obstacles.forEach((obstacle) => {
    const rect = getObstacleRect(obstacle, elapsedMs);
    if (!rect) {
      return;
    }

    gameCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
    gameCtx.fillRect(rect.x + rect.width * 0.38, rect.y - rect.height * 0.42, 8, rect.height * 0.42);
  });
}

function drawDino() {
  const rect = getDinoRect();
  gameCtx.fillStyle = "#233955";
  gameCtx.fillRect(rect.x, rect.y + 6, rect.width, rect.height - 6);
  gameCtx.fillRect(rect.x + rect.width - 12, rect.y, 12, 14);
  gameCtx.fillStyle = "#eef8ff";
  gameCtx.fillRect(rect.x + rect.width - 9, rect.y + 4, 3, 3);
  gameCtx.fillStyle = "#233955";
  gameCtx.fillRect(rect.x + 6, rect.y + rect.height - 4, 8, 10);
  gameCtx.fillRect(rect.x + 22, rect.y + rect.height - 4, 8, 10);
}

function drawOverlay(title, subtitle) {
  gameCtx.fillStyle = "rgba(16, 24, 40, 0.1)";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  gameCtx.fillStyle = "#17304c";
  gameCtx.font = "700 32px Avenir Next";
  gameCtx.fillText(title, 34, 52);
  gameCtx.fillStyle = "#607186";
  gameCtx.font = "18px Avenir Next";
  gameCtx.fillText(subtitle, 34, 82);
}

function updateGameMetrics() {
  const me = getMyParticipant();
  els.myScoreText.textContent = String(state.localGame.score || me?.latestScore || 0);
  els.bestScoreText.textContent = String(me?.bestScore || 0);
  els.totalScoreText.textContent = String(me?.totalScore || 0);
  els.winsText.textContent = String(me?.wins || 0);
}

function roomPhaseLabel(room) {
  if (!room) {
    return "報到中";
  }

  if (room.phase === "countdown") {
    return "同步倒數";
  }
  if (room.phase === "running") {
    return "比賽進行中";
  }
  if (room.phase === "results") {
    return "成績公布";
  }
  return "等待室";
}

function updateCountdownBanner(room) {
  if (!room) {
    els.countdownBanner.textContent = "等待加入房間";
    return;
  }

  if (room.phase === "countdown" && room.round.startAt) {
    const remainingMs = Math.max(0, room.round.startAt - getServerNow());
    els.countdownBanner.textContent = `第 ${room.round.number} 回合 ${Math.ceil(remainingMs / 1000)} 秒後同步起跑`;
    return;
  }

  if (room.phase === "running") {
    els.countdownBanner.textContent = `第 ${room.round.number} 回合進行中，存活玩家 ${room.round.aliveCount} 位`;
    return;
  }

  if (room.phase === "results" && room.round.standings.length > 0) {
    const champion = room.round.standings[0];
    els.countdownBanner.textContent = `第 ${room.round.number} 回合冠軍：${champion.nickname}，得分 ${champion.score}`;
    return;
  }

  els.countdownBanner.textContent = "等待主持人開始";
}

function renderLeaderboard(room) {
  if (!room) {
    els.leaderboardList.innerHTML = "<p>尚未加入任何房間</p>";
    return;
  }

  const standingsById = new Map(room.round.standings.map((entry) => [entry.participantId, entry]));
  els.leaderboardList.innerHTML = room.participants
    .map((participant) => {
      const badge = getParticipantBadge(participant);
      const roundStanding = standingsById.get(participant.id);
      const roundPlacement = roundStanding ? `第 ${roundStanding.placement} 名` : participant.activeThisRound ? "本回合參賽" : "等待下一回合";
      return `
        <article class="leaderboard-item">
          <div class="leaderboard-topline">
            <div>
              <strong>${escapeHtml(participant.nickname)}</strong>
              <span class="badge ${badge.className}">${badge.text}</span>
            </div>
            <strong>${roundPlacement}</strong>
          </div>
          <div class="leaderboard-meta">
            <span>角色：${participant.role === "host" ? "主持人" : "玩家"}</span>
            <span>跳躍姿勢：${escapeHtml(participant.selectedLabel || "-")}</span>
            <span>本回合：${participant.latestScore}</span>
            <span>最佳：${participant.bestScore}</span>
            <span>累積：${participant.totalScore}</span>
            <span>冠軍：${participant.wins}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function getParticipantBadge(participant) {
  if (participant.role === "host") {
    return { className: "host", text: "主持人" };
  }
  if (participant.activeThisRound && participant.isAlive) {
    return { className: "ready", text: "存活中" };
  }
  if (participant.activeThisRound && !participant.isAlive) {
    return { className: "dead", text: "已淘汰" };
  }
  if (participant.readyToRace) {
    return { className: "ready", text: "已就緒" };
  }
  return { className: "waiting", text: "等待設定" };
}

function renderHistory(room) {
  if (!room || room.history.length === 0) {
    els.historyList.innerHTML = "<p>回合結束後，這裡會保留主持人可用的頒獎資料。</p>";
    return;
  }

  els.historyList.innerHTML = room.history
    .map((round) => {
      const summary = round.standings
        .slice(0, 3)
        .map((entry) => `${entry.placement}. ${escapeHtml(entry.nickname)} (${entry.score})`)
        .join(" / ");

      return `
        <article class="history-item">
          <div class="history-topline">
            <strong>第 ${round.number} 回合</strong>
            <span>${summary || "尚無成績"}</span>
          </div>
          <div class="history-meta">
            ${round.standings.map((entry) => `<span>${entry.placement}. ${escapeHtml(entry.nickname)} ${entry.score}</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderEvents(room) {
  if (!room) {
    els.eventLog.innerHTML = "<li>尚未加入任何房間</li>";
    return;
  }

  els.eventLog.innerHTML = room.events
    .map((event) => `<li>${escapeHtml(event.message)}</li>`)
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderRoom(room) {
  state.latestRoom = room;
  state.serverOffsetMs = room.serverTime - Date.now();

  els.roomStatusText.textContent = room.id;
  els.phaseText.textContent = roomPhaseLabel(room);
  els.roundText.textContent = String(room.round.number);
  updateCountdownBanner(room);

  const me = room.me;
  const champion = room.round.standings[0];
  els.winnerText.textContent = champion
    ? `本回合冠軍：${champion.nickname} (${champion.score})`
    : "尚未產生本回合冠軍";

  els.hostPanel.classList.toggle("hidden", !(me && me.role === "host"));
  els.startRoundButton.disabled = !(me && me.role === "host" && room.canStartRound);
  els.resetLeaderboardButton.disabled = !(me && me.role === "host");

  const readyPlayers = room.participants.filter((participant) => participant.readyToRace).length;
  const totalPlayers = room.participants.filter((participant) => participant.role === "player").length;
  els.hostSummaryText.textContent =
    room.phase === "running"
      ? `本回合 ${room.round.activeParticipantIds.length} 位玩家參賽，目前存活 ${room.round.aliveCount} 位`
      : `房內共有 ${totalPlayers} 位玩家，其中 ${readyPlayers} 位已完成模型與鏡頭準備`;

  els.playerStateText.textContent = me ? me.currentState || "待命" : "待命";
  els.selectedPoseText.textContent = state.selectedLabel || me?.selectedLabel || "-";
  els.gameStatusText.textContent =
    state.role === "host"
      ? "主持模式"
      : room.phase === "running"
        ? state.localGame.status === "dead"
          ? "已淘汰"
          : "奔跑中"
        : room.phase === "countdown"
          ? "準備起跑"
          : room.phase === "results"
            ? "回合結束"
            : "等待開局";

  updateGameMetrics();
  renderLeaderboard(room);
  renderHistory(room);
  renderEvents(room);
}

async function joinRoom() {
  try {
    state.nickname = els.nicknameInput.value.trim() || (state.role === "host" ? "主持人" : "玩家");
    state.roomId = els.roomInput.value.trim();
    state.selectedLabel = els.labelSelect.value;

    if (!state.roomId) {
      throw new Error("請輸入房間號碼");
    }

    if (state.role === "player") {
      if (!state.model || !state.cameraReady || !state.selectedLabel) {
        throw new Error("玩家需先完成模型載入、鏡頭測試與姿勢選擇");
      }
    }

    await api("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({
        roomId: state.roomId,
        participantId: state.participantId,
        nickname: state.nickname,
        role: state.role,
      }),
    });

    state.joined = true;
    els.leaveHintButton.textContent = "房間同步中";
    setStatus(`已加入房間 ${state.roomId}`);
    await syncPresence(false);
    startPolling();
    startAnimationLoop();
  } catch (error) {
    console.error(error);
    setStatus(`加入房間失敗：${error.message}`);
  }
}

function startPolling() {
  stopPolling();

  state.pollTimer = window.setInterval(async () => {
    if (!state.roomId) {
      return;
    }

    try {
      const data = await api(
        `/api/rooms/state?roomId=${encodeURIComponent(state.roomId)}&participantId=${encodeURIComponent(state.participantId)}`
      );
      renderRoom(data.room);
    } catch (error) {
      console.error(error);
      setStatus(`房間同步失敗：${error.message}`);
    }
  }, 800);

  state.syncTimer = window.setInterval(() => {
    syncPresence(false).catch((error) => {
      console.error(error);
    });
  }, 900);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  if (state.syncTimer) {
    clearInterval(state.syncTimer);
    state.syncTimer = null;
  }
}

async function syncPresence(reportDeath) {
  if (!state.joined || !state.roomId) {
    return;
  }

  state.selectedLabel = els.labelSelect.value || state.selectedLabel;
  const payload = {
    roomId: state.roomId,
    participantId: state.participantId,
    nickname: els.nicknameInput.value.trim() || state.nickname,
    modelUrl: state.role === "player" ? state.modelUrl : "",
    modelName: state.role === "player" ? state.modelName : "",
    labels: state.role === "player" ? state.labels : [],
    selectedLabel: state.role === "player" ? state.selectedLabel : "",
    cameraReady: state.role === "player" ? state.cameraReady : false,
    lobbyReady: state.role === "player" ? true : true,
    currentLabel: state.role === "player" ? state.currentPose : "",
    currentConfidence: state.role === "player" ? state.currentConfidence : 0,
    currentDistance: state.role === "player" ? state.localGame.score : 0,
    latestScore: state.role === "player" ? state.localGame.score : 0,
    currentState:
      state.role === "host"
        ? "hosting"
        : state.localGame.status === "dead"
          ? "dead"
          : state.localGame.status === "running"
            ? "running"
            : state.localGame.status === "countdown"
              ? "countdown"
              : "ready",
    roundNumber: state.localGame.roundNumber,
    reportDeath: Boolean(reportDeath),
  };

  const data = await api("/api/rooms/update", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  renderRoom(data.room);
}

async function startRound() {
  try {
    const data = await api("/api/rooms/host/start-round", {
      method: "POST",
      body: JSON.stringify({
        roomId: state.roomId,
        participantId: state.participantId,
      }),
    });
    renderRoom(data.room);
    setStatus(`已啟動第 ${data.room.round.number} 回合倒數`);
  } catch (error) {
    console.error(error);
    setStatus(`啟動回合失敗：${error.message}`);
  }
}

async function resetLeaderboard() {
  try {
    const data = await api("/api/rooms/host/reset-leaderboard", {
      method: "POST",
      body: JSON.stringify({
        roomId: state.roomId,
        participantId: state.participantId,
      }),
    });
    state.localGame = createLocalGameState();
    renderRoom(data.room);
    setStatus("已重置所有回合紀錄");
  } catch (error) {
    console.error(error);
    setStatus(`重置排行榜失敗：${error.message}`);
  }
}

els.roleSelect.addEventListener("change", updateRoleUI);
els.loadModelButton.addEventListener("click", loadModel);
els.cameraButton.addEventListener("click", startCamera);
els.joinRoomButton.addEventListener("click", joinRoom);
els.startRoundButton.addEventListener("click", startRound);
els.resetLeaderboardButton.addEventListener("click", resetLeaderboard);
els.labelSelect.addEventListener("change", () => {
  state.selectedLabel = els.labelSelect.value;
  els.selectedPoseText.textContent = state.selectedLabel || "-";
  refreshActionButtons();
});
els.thresholdInput.addEventListener("input", updateThreshold);
[els.nicknameInput, els.roomInput].forEach((element) => {
  element.addEventListener("input", refreshActionButtons);
});

updateThreshold();
updateRoleUI();
els.apiBaseUrlText.textContent = state.apiBaseUrl || `${window.location.origin} (same-origin)`;
setStatus("玩家請完成模型與鏡頭測試後加入等待室；主持人可直接加入房間");
renderCameraPlaceholder();
drawIdleGame("等待加入房間");
startAnimationLoop();
