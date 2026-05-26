const PLAYER_STORAGE_KEY = "pose_dino_party_participant_id";
const PREF_STORAGE_KEY = "pose_dino_party_preferences";
const fallbackParticipantId = crypto.randomUUID();
const GAME_OPTIONS = [
  { id: "dino_party", name: "情境一：草原小恐龍" },
  { id: "space_battle", name: "情境二：太空船躲避戰" },
  { id: "chrome_runner", name: "情境三：Chrome 復古小恐龍" },
];

const state = {
  participantId: sessionStorage.getItem(PLAYER_STORAGE_KEY) || fallbackParticipantId,
  apiBaseUrl: resolveApiBaseUrl(),
  role: "player",
  nickname: "",
  roomId: "",
  modelUrl: "",
  modelName: "",
  model: null,
  modelType: "",
  modelPackageName: "",
  labels: [],
  actionLabels: {
    jump: "",
    stay: "",
    down: "",
  },
  maxPredictions: 0,
  threshold: 0.86,
  webcam: null,
  cameraReady: false,
  predictBusy: false,
  animationStarted: false,
  joined: false,
  lobbyReady: false,
  latestRoom: null,
  pollTimer: null,
  syncTimer: null,
  currentPose: "",
  currentConfidence: 0,
  currentCommand: "stay",
  predictions: [],
  poseArmed: false,
  serverOffsetMs: 0,
  localGame: createLocalGameState(),
  view: "setup",
  lastFullscreenRound: 0,
  needsFullscreenButton: false,
  preparingNextRound: false,
};

sessionStorage.setItem(PLAYER_STORAGE_KEY, state.participantId);

const els = {
  globalStatus: document.getElementById("globalStatus"),
  screenSetup: document.getElementById("screenSetup"),
  screenTest: document.getElementById("screenTest"),
  screenLobby: document.getElementById("screenLobby"),
  screenGame: document.getElementById("screenGame"),
  screenResults: document.getElementById("screenResults"),
  roleSelect: document.getElementById("roleSelect"),
  nicknameInput: document.getElementById("nicknameInput"),
  roomInput: document.getElementById("roomInput"),
  modelUrlField: document.getElementById("modelUrlField"),
  modelUrlInput: document.getElementById("modelUrlInput"),
  enterRoomButton: document.getElementById("enterRoomButton"),
  testRoomLabel: document.getElementById("testRoomLabel"),
  testPlayerLabel: document.getElementById("testPlayerLabel"),
  testModelStatus: document.getElementById("testModelStatus"),
  testCameraStatus: document.getElementById("testCameraStatus"),
  testCurrentPose: document.getElementById("testCurrentPose"),
  testCurrentConfidence: document.getElementById("testCurrentConfidence"),
  testCurrentCommand: document.getElementById("testCurrentCommand"),
  predictionList: document.getElementById("predictionList"),
  jumpLabelSelect: document.getElementById("jumpLabelSelect"),
  stayLabelSelect: document.getElementById("stayLabelSelect"),
  downLabelSelect: document.getElementById("downLabelSelect"),
  thresholdInput: document.getElementById("thresholdInput"),
  thresholdValue: document.getElementById("thresholdValue"),
  backToSetupButton: document.getElementById("backToSetupButton"),
  goToLobbyButton: document.getElementById("goToLobbyButton"),
  lobbyRoomText: document.getElementById("lobbyRoomText"),
  lobbyPhaseText: document.getElementById("lobbyPhaseText"),
  lobbyPlayerCount: document.getElementById("lobbyPlayerCount"),
  lobbyReadyCount: document.getElementById("lobbyReadyCount"),
  lobbyMyState: document.getElementById("lobbyMyState"),
  lobbyCountdownText: document.getElementById("lobbyCountdownText"),
  lobbyModelSummary: document.getElementById("lobbyModelSummary"),
  lobbyRetestButton: document.getElementById("lobbyRetestButton"),
  hostStartButton: document.getElementById("hostStartButton"),
  lobbyParticipantsList: document.getElementById("lobbyParticipantsList"),
  lobbyEventsList: document.getElementById("lobbyEventsList"),
  gameRoomText: document.getElementById("gameRoomText"),
  gameRoundText: document.getElementById("gameRoundText"),
  gameStateText: document.getElementById("gameStateText"),
  gameScoreText: document.getElementById("gameScoreText"),
  gameBanner: document.getElementById("gameBanner"),
  gameFullscreenButton: document.getElementById("gameFullscreenButton"),
  gamePoseText: document.getElementById("gamePoseText"),
  cameraVideo: document.getElementById("cameraVideo"),
  cameraVideoClone: document.getElementById("cameraVideoClone"),
  cameraCanvas: document.getElementById("cameraCanvas"),
  cameraCanvasClone: document.getElementById("cameraCanvasClone"),
  gameCanvas: document.getElementById("gameCanvas"),
  resultsRoomText: document.getElementById("resultsRoomText"),
  resultsRoundText: document.getElementById("resultsRoundText"),
  resultsChampionText: document.getElementById("resultsChampionText"),
  resultsLeaderboardList: document.getElementById("resultsLeaderboardList"),
  resultsHistoryList: document.getElementById("resultsHistoryList"),
  resultsPlayerCard: document.getElementById("resultsPlayerCard"),
  resultsHostCard: document.getElementById("resultsHostCard"),
  resultsModelUrlInput: document.getElementById("resultsModelUrlInput"),
  resultsReadyHint: document.getElementById("resultsReadyHint"),
  resultsRetestButton: document.getElementById("resultsRetestButton"),
  resultsUpdateModelButton: document.getElementById("resultsUpdateModelButton"),
  resultsStartAgainButton: document.getElementById("resultsStartAgainButton"),
  resultsEventsList: document.getElementById("resultsEventsList"),
  hostGameSelectWrap: document.getElementById("hostGameSelectWrap"),
  hostGameSelect: document.getElementById("hostGameSelect"),
  resultsGameSelect: document.getElementById("resultsGameSelect"),
  gameScenarioText: document.getElementById("gameScenarioText"),
};

const cameraCtx = els.cameraCanvas.getContext("2d");
const cameraCloneCtx = els.cameraCanvasClone.getContext("2d");
const gameCtx = els.gameCanvas.getContext("2d");

function createLocalGameState() {
  return {
    roundNumber: 0,
    seed: null,
    gameId: "dino_party",
    startAt: null,
    status: "idle",
    score: 0,
    reportedDeath: false,
    obstacles: [],
    chromeObstacles: [],
    chromeSpeedMultiplier: 1,
    ship: {
      x: 100,
      y: 360,
      size: 40,
      speed: 7,
      cooldown: 0,
      hp: 3,
    },
    asteroids: [],
    lasers: [],
    dino: {
      x: 180,
      y: 0,
      vy: 0,
      standingWidth: 82,
      standingHeight: 92,
      crouchWidth: 108,
      crouchHeight: 58,
      isCrouching: false,
    },
    physics: {
      jumpVelocity: 980,
      gravity: 2500,
      groundY: 590,
    },
  };
}

function getGameOption(gameId) {
  return GAME_OPTIONS.find((item) => item.id === gameId) || GAME_OPTIONS[0];
}

function getGameName(gameId) {
  return getGameOption(gameId).name;
}

function resolveApiBaseUrl() {
  const rawValue =
    window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE_URL === "string" ? window.APP_CONFIG.API_BASE_URL : "";

  return rawValue.trim().replace(/\/+$/, "");
}

function getApiUrl(path) {
  return `${state.apiBaseUrl}${path}`;
}

function getServerNow() {
  return Date.now() + state.serverOffsetMs;
}

function setStatus(message, tone = "info") {
  els.globalStatus.textContent = message;
  els.globalStatus.className = `global-status ${tone === "info" ? "" : tone}`.trim();
}

function savePreferences() {
  const payload = {
    role: els.roleSelect.value,
    nickname: els.nicknameInput.value.trim(),
    roomId: els.roomInput.value.trim(),
    modelUrl: els.modelUrlInput.value.trim(),
    threshold: Number(els.thresholdInput.value),
  };
  localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(payload));
}

function restorePreferences() {
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    els.roleSelect.value = saved.role === "host" ? "host" : "player";
    els.nicknameInput.value = saved.nickname || "";
    els.roomInput.value = saved.roomId || "";
    els.modelUrlInput.value = saved.modelUrl || "";
    els.resultsModelUrlInput.value = saved.modelUrl || "";
    els.thresholdInput.value = String(saved.threshold || 0.86);
  } catch (error) {
    console.warn("Failed to restore preferences", error);
  }
}

function normalizeModelBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    throw new Error("請先輸入模型 URL");
  }

  const url = new URL(trimmed);
  url.search = "";
  url.hash = "";

  if (url.pathname.endsWith("/model.json")) {
    url.pathname = url.pathname.slice(0, -"/model.json".length);
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }

  return url.toString();
}

async function fetchModelMetadata(baseUrl) {
  const response = await fetch(`${baseUrl}metadata.json`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("無法讀取模型 metadata.json");
  }

  return response.json();
}

function resolveModelType(metadata) {
  const packageName = String(metadata?.packageName || "").toLowerCase();
  if (packageName.includes("/image")) {
    return "image";
  }
  if (packageName.includes("/pose")) {
    return "pose";
  }
  throw new Error("目前只支援 Teachable Machine Image 或 Pose 模型");
}

function normalizeActionLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function pickLabelByAliases(labels, aliases, used) {
  const normalizedAliases = aliases.map(normalizeActionLabel);
  const exact = labels.find((label) => !used.has(label) && normalizedAliases.includes(normalizeActionLabel(label)));
  if (exact) {
    return exact;
  }

  const fuzzy = labels.find((label) => {
    if (used.has(label)) {
      return false;
    }
    const normalized = normalizeActionLabel(label);
    return normalizedAliases.some((alias) => normalized.includes(alias) || alias.includes(normalized));
  });

  return fuzzy || "";
}

function guessActionLabels(labels) {
  const aliases = {
    jump: ["jump", "up", "raise", "hop", "jumping", "跳", "跳躍"],
    stay: ["stay", "idle", "stand", "normal", "still", "default", "ready", "站", "站立"],
    down: ["down", "duck", "crouch", "squat", "sit", "蹲", "蹲下"],
  };
  const mapping = {
    jump: "",
    stay: "",
    down: "",
  };
  const used = new Set();

  for (const key of ["jump", "stay", "down"]) {
    const match = pickLabelByAliases(labels, aliases[key], used);
    if (match) {
      mapping[key] = match;
      used.add(match);
    }
  }

  const remaining = labels.filter((label) => !used.has(label));
  for (const key of ["jump", "stay", "down"]) {
    if (!mapping[key] && remaining.length > 0) {
      mapping[key] = remaining.shift();
    }
  }

  return mapping;
}

function formatActionLabels() {
  const { jump, stay, down } = state.actionLabels;
  return [jump, stay, down].filter(Boolean).join(" / ");
}

function isActionMappingComplete() {
  const { jump, stay, down } = state.actionLabels;
  return Boolean(jump && stay && down && jump !== stay && jump !== down && stay !== down);
}

function getMyParticipant() {
  return state.latestRoom ? state.latestRoom.me : null;
}

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;

  const views = {
    setup: els.screenSetup,
    test: els.screenTest,
    lobby: els.screenLobby,
    game: els.screenGame,
    results: els.screenResults,
  };

  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("hidden", key !== view);
  });

  if (view === "game") {
    tryEnterFullscreen(false);
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function populateGameSelects() {
  const options = GAME_OPTIONS.map((game) => `<option value="${game.id}">${game.name}</option>`).join("");
  els.hostGameSelect.innerHTML = options;
  els.resultsGameSelect.innerHTML = options;
}

function syncGameSelectValues(gameId) {
  const nextValue = getGameOption(gameId).id;
  els.hostGameSelect.value = nextValue;
  els.resultsGameSelect.value = nextValue;
  els.gameScenarioText.textContent = getGameName(gameId);
}

function updateRoleUI() {
  state.role = els.roleSelect.value === "host" ? "host" : "player";
  els.modelUrlField.classList.toggle("hidden", state.role === "host");
  els.lobbyRetestButton.classList.toggle("hidden", state.role === "host");
  els.resultsPlayerCard.classList.toggle("hidden", state.role === "host");
  els.resultsHostCard.classList.toggle("hidden", state.role !== "host");
  els.enterRoomButton.textContent = state.role === "host" ? "進入主持等待室" : "進入房間";
  refreshSetupButtonState();
}

function refreshSetupButtonState() {
  const hasName = Boolean(els.nicknameInput.value.trim());
  const hasRoom = Boolean(els.roomInput.value.trim());
  const hasModelUrl = Boolean(els.modelUrlInput.value.trim());
  els.enterRoomButton.disabled = state.role === "host" ? !(hasName && hasRoom) : !(hasName && hasRoom && hasModelUrl);
}

function updateThreshold() {
  state.threshold = Number(els.thresholdInput.value);
  els.thresholdValue.textContent = state.threshold.toFixed(2);
  savePreferences();
}

function populateLabelSelects(labels) {
  const options = [`<option value="">請選擇標籤</option>`]
    .concat(labels.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`))
    .join("");

  els.jumpLabelSelect.innerHTML = options;
  els.stayLabelSelect.innerHTML = options;
  els.downLabelSelect.innerHTML = options;

  els.jumpLabelSelect.value = state.actionLabels.jump || "";
  els.stayLabelSelect.value = state.actionLabels.stay || "";
  els.downLabelSelect.value = state.actionLabels.down || "";
}

function syncActionLabelsFromInputs() {
  state.actionLabels = {
    jump: els.jumpLabelSelect.value,
    stay: els.stayLabelSelect.value,
    down: els.downLabelSelect.value,
  };
  refreshTestingButtonState();
}

function refreshTestingButtonState() {
  const ready = Boolean(state.model && state.cameraReady && isActionMappingComplete());
  els.goToLobbyButton.disabled = !ready;
  els.testModelStatus.textContent = state.model
    ? `模型已載入 ${state.modelName} (${state.modelType || "unknown"})`
    : "模型未載入";
  els.testCameraStatus.textContent = state.cameraReady ? "鏡頭已啟動" : "鏡頭未啟動";
}

function renderPredictionList() {
  const predictionRows =
    state.predictions.length > 0
      ? state.predictions
      : state.labels.map((label) => ({
          className: label,
          probability: 0,
        }));

  if (predictionRows.length === 0) {
    els.predictionList.innerHTML = "<p class=\"muted-copy\">載入模型後，這裡會顯示每個類別的即時百分比。</p>";
    return;
  }

  els.predictionList.innerHTML = predictionRows
    .map((prediction) => {
      const percentage = (prediction.probability * 100).toFixed(1);
      return `
        <article class="prediction-item">
          <div class="prediction-topline">
            <strong>${escapeHtml(prediction.className)}</strong>
            <span>${percentage}%</span>
          </div>
          <div class="prediction-bar"><span style="width:${percentage}%"></span></div>
        </article>
      `;
    })
    .join("");
}

function renderPoseMetrics() {
  els.testCurrentPose.textContent = state.currentPose || "尚未辨識";
  els.testCurrentConfidence.textContent = `${(state.currentConfidence * 100).toFixed(1)}%`;
  els.testCurrentCommand.textContent = state.currentCommand;
  els.gamePoseText.textContent = state.currentPose || "尚未辨識";
}

function drawCameraPlaceholder() {
  [cameraCtx, cameraCloneCtx].forEach((ctx) => {
    ctx.clearRect(0, 0, els.cameraCanvas.width, els.cameraCanvas.height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.fillRect(0, 0, els.cameraCanvas.width, els.cameraCanvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 24px Avenir Next";
    ctx.fillText("等待鏡頭啟動", 32, 48);
    ctx.font = "16px Avenir Next";
    ctx.fillText("進入房間後會自動啟動相機與模型測試。", 32, 78);
  });
}

function drawCameraFeeds(pose) {
  const targets = [
    [cameraCtx, els.cameraCanvas],
    [cameraCloneCtx, els.cameraCanvasClone],
  ];

  targets.forEach(([ctx, canvas]) => {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    if (state.webcam?.canvas) {
      ctx.drawImage(state.webcam.canvas, 0, 0, canvas.width, canvas.height);
    }
    if (pose && state.modelType === "pose") {
      tmPose.drawKeypoints(pose.keypoints, 0.45, ctx);
      tmPose.drawSkeleton(pose.keypoints, 0.45, ctx);
    }
    ctx.restore();
  });
}

async function loadModel() {
  const baseUrl = normalizeModelBaseUrl(els.modelUrlInput.value);
  setStatus("正在載入模型...");

  const metadata = await fetchModelMetadata(baseUrl);
  const modelType = resolveModelType(metadata);
  const modelURL = `${baseUrl}model.json`;
  const metadataURL = `${baseUrl}metadata.json`;
  const loader = modelType === "pose" ? tmPose : tmImage;
  const model = await loader.load(modelURL, metadataURL);
  const labels = Array.isArray(metadata.labels) && metadata.labels.length > 0
    ? metadata.labels
    : Array.from({ length: model.getTotalClasses() }, (_, index) => model.getClassLabels()[index]);

  if (labels.length < 3) {
    throw new Error("模型至少需要 3 個類別，才能對應 Jump / Stay / Down");
  }

  state.model = model;
  state.modelType = modelType;
  state.modelPackageName = String(metadata.packageName || "");
  state.modelUrl = baseUrl;
  state.modelName = new URL(baseUrl).pathname.split("/").filter(Boolean).pop() || "Pose Model";
  state.maxPredictions = model.getTotalClasses();
  state.labels = labels;
  state.predictions = labels.map((label) => ({
    className: label,
    probability: 0,
  }));
  state.actionLabels = guessActionLabels(labels);
  populateLabelSelects(labels);
  renderPredictionList();
  refreshTestingButtonState();
  syncModelInputs(baseUrl);
  setStatus(`模型已載入，偵測到 ${modelType} 類型，請確認 Jump / Stay / Down 的標籤對應`);
}

async function ensureCameraReady() {
  if (state.role !== "player") {
    return;
  }

  if (state.cameraReady && state.webcam) {
    return;
  }

  if (!state.model) {
    throw new Error("請先載入模型");
  }

  setStatus("正在啟動鏡頭...");
  const WebcamClass = state.modelType === "pose" ? tmPose.Webcam : tmImage.Webcam;
  state.webcam = new WebcamClass(480, 360, false);
  await state.webcam.setup();
  await state.webcam.play();

  if (state.webcam.webcam && state.webcam.webcam.srcObject) {
    els.cameraVideo.srcObject = state.webcam.webcam.srcObject;
    els.cameraVideoClone.srcObject = state.webcam.webcam.srcObject;
    try {
      await Promise.all([els.cameraVideo.play(), els.cameraVideoClone.play()]);
    } catch (error) {
      console.warn("Video autoplay blocked", error);
    }
  }

  state.cameraReady = true;
  drawCameraFeeds(null);
  refreshTestingButtonState();
  setStatus("鏡頭已啟動，請做出姿勢測試模型辨識結果");
}

function computePoseCommand() {
  if (!isActionMappingComplete() || state.currentConfidence < state.threshold) {
    return "stay";
  }

  if (state.currentPose === state.actionLabels.jump) {
    return "jump";
  }
  if (state.currentPose === state.actionLabels.down) {
    return "down";
  }
  if (state.currentPose === state.actionLabels.stay) {
    return "stay";
  }

  return "stay";
}

async function runPosePrediction() {
  if (!state.webcam || !state.model) {
    return;
  }

  state.webcam.update();
  let pose = null;
  let predictions = [];

  if (state.modelType === "pose") {
    const poseResult = await state.model.estimatePose(state.webcam.canvas);
    pose = poseResult.pose;
    predictions = await state.model.predict(poseResult.posenetOutput);
  } else {
    predictions = await state.model.predict(state.webcam.canvas);
  }

  if (!predictions || predictions.length === 0) {
    return;
  }

  const bestPrediction = predictions.reduce((top, item) => (item.probability > top.probability ? item : top), predictions[0]);
  state.predictions = predictions
    .map((item) => ({
      className: item.className,
      probability: item.probability,
    }))
    .sort((left, right) => right.probability - left.probability);
  state.currentPose = bestPrediction.className;
  state.currentConfidence = bestPrediction.probability;
  state.currentCommand = computePoseCommand();

  drawCameraFeeds(pose);
  renderPoseMetrics();
  renderPredictionList();
  applyPoseCommand();
}

function startAnimationLoop() {
  if (state.animationStarted) {
    return;
  }

  state.animationStarted = true;
  drawCameraPlaceholder();
  let lastFrameAt = performance.now();

  const loop = (frameAt) => {
    const deltaMs = frameAt - lastFrameAt;
    lastFrameAt = frameAt;

    if (state.role === "player" && state.webcam && state.model && !state.predictBusy) {
      state.predictBusy = true;
      runPosePrediction()
        .catch((error) => {
          console.error(error);
          setStatus(`模型推論失敗：${error.message}`, "warn");
        })
        .finally(() => {
          state.predictBusy = false;
        });
    }

    updateLocalGame(deltaMs);
    renderGame();
    window.requestAnimationFrame(loop);
  };

  window.requestAnimationFrame(loop);
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

async function joinRoomApi() {
  const data = await api("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({
      roomId: state.roomId,
      participantId: state.participantId,
      nickname: state.nickname,
      role: state.role,
    }),
  });

  state.joined = true;
  renderRoom(data.room);
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
      setStatus(`房間同步失敗：${error.message}`, "warn");
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

  const payload = {
    roomId: state.roomId,
    participantId: state.participantId,
    nickname: state.nickname,
    modelUrl: state.role === "player" ? state.modelUrl : "",
    modelName: state.role === "player" ? state.modelName : "",
    labels: state.role === "player" ? state.labels : [],
    selectedLabel: state.role === "player" ? formatActionLabels() : "",
    cameraReady: state.role === "player" ? state.cameraReady : false,
    lobbyReady: state.role === "player" ? state.lobbyReady : true,
    currentLabel: state.role === "player" ? state.currentPose : "",
    currentConfidence: state.role === "player" ? state.currentConfidence : 0,
    currentDistance: state.role === "player" ? state.localGame.score : 0,
    latestScore: state.role === "player" ? state.localGame.score : 0,
    currentState:
      state.role === "host"
        ? "hosting"
        : state.localGame.status === "dead"
          ? "dead"
          : state.view === "test"
            ? "testing"
            : state.view === "game"
              ? state.localGame.status || "running"
              : state.lobbyReady
                ? "ready"
                : "waiting",
    roundNumber: state.localGame.roundNumber,
    reportDeath: Boolean(reportDeath),
  };

  const data = await api("/api/rooms/update", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  renderRoom(data.room);
}

async function handleEnterRoom() {
  try {
    savePreferences();
    state.nickname = els.nicknameInput.value.trim() || (state.role === "host" ? "主持人" : "玩家");
    state.roomId = els.roomInput.value.trim();
    state.lobbyReady = false;
    state.preparingNextRound = false;

    if (!state.nickname) {
      throw new Error("請先輸入名稱");
    }
    if (!state.roomId) {
      throw new Error("請先輸入房間號碼");
    }

    if (state.role === "player") {
      await loadModel();
      await ensureCameraReady();
    }

    await joinRoomApi();
    await syncPresence(false);
    startPolling();

    if (state.role === "player") {
      updateTestHeader();
      setView("test");
      setStatus("已進入房間，請先測試模型辨識並確認三個動作對應");
    } else {
      setView("lobby");
      setStatus("已進入主持等待室，等待玩家完成模型測試");
    }
  } catch (error) {
    console.error(error);
    setStatus(`進入房間失敗：${error.message}`, "error");
  }
}

function updateTestHeader() {
  els.testRoomLabel.textContent = `房間 ${state.roomId || "-"}`;
  els.testPlayerLabel.textContent = `${state.nickname || "玩家"}`;
}

async function confirmTestAndGoLobby() {
  if (!state.model || !state.cameraReady || !isActionMappingComplete()) {
    setStatus("請先完成模型測試並確認 Jump / Stay / Down 三個標籤", "warn");
    return;
  }

  state.lobbyReady = true;
  state.preparingNextRound = true;
  await syncPresence(false);
  setView("lobby");
  setStatus("已完成模型測試，正在等待主持人開始");
}

async function goBackToTestingFromRoom() {
  if (state.role !== "player") {
    return;
  }

  state.lobbyReady = false;
  state.preparingNextRound = true;
  await syncPresence(false);
  updateTestHeader();
  setView("test");
  setStatus("你可以重新測試模型，確認辨識結果後再回等待室");
}

async function updateModelFromResults() {
  try {
    const nextUrl = els.resultsModelUrlInput.value.trim();
    if (!nextUrl) {
      throw new Error("請先輸入新的模型 URL");
    }

    els.modelUrlInput.value = nextUrl;
    savePreferences();
    state.lobbyReady = false;
    state.preparingNextRound = true;
    await loadModel();
    await ensureCameraReady();
    await syncPresence(false);
    updateTestHeader();
    setView("test");
    setStatus("模型已更新，請重新測試後再進入等待室");
  } catch (error) {
    console.error(error);
    setStatus(`更新模型失敗：${error.message}`, "error");
  }
}

async function startRound() {
  try {
    state.preparingNextRound = false;
    const data = await api("/api/rooms/host/start-round", {
      method: "POST",
      body: JSON.stringify({
        roomId: state.roomId,
        participantId: state.participantId,
      }),
    });
    renderRoom(data.room);
    setView("lobby");
    setStatus(`主持人已啟動第 ${data.room.round.number} 回合`);
  } catch (error) {
    console.error(error);
    setStatus(`開始遊戲失敗：${error.message}`, "error");
  }
}

async function updateRoomGame(gameId) {
  if (!state.roomId) {
    return;
  }

  const data = await api("/api/rooms/host/select-game", {
    method: "POST",
    body: JSON.stringify({
      roomId: state.roomId,
      participantId: state.participantId,
      gameId,
    }),
  });

  renderRoom(data.room);
  setStatus(`主持人已將下一回合切換為 ${getGameName(gameId)}`);
}

function roomPhaseLabel(room) {
  if (!room) {
    return "等待加入房間";
  }
  if (room.phase === "countdown") {
    return "倒數中";
  }
  if (room.phase === "running") {
    return "遊戲進行中";
  }
  if (room.phase === "results") {
    return "排行榜";
  }
  return "等待室";
}

function renderParticipants(element, room) {
  if (!room || room.participants.length === 0) {
    element.innerHTML = "<p class=\"muted-copy\">尚未有玩家加入</p>";
    return;
  }

  const standings = new Map(room.round.standings.map((entry) => [entry.participantId, entry]));
  element.innerHTML = room.participants
    .map((participant) => {
      const badge = getParticipantBadge(participant);
      const standing = standings.get(participant.id);
      const placement = standing ? `第 ${standing.placement} 名` : participant.readyToRace ? "已就緒" : "設定中";
      return `
        <article class="participant-item ${participant.isRequester ? "me" : ""}">
          <div class="participant-topline">
            <div>
              <strong>${escapeHtml(participant.nickname)}</strong>
              <span class="badge ${badge.className}">${badge.text}</span>
            </div>
            <strong>${placement}</strong>
          </div>
          <div class="participant-meta">
            <span>角色：${participant.role === "host" ? "主持人" : "玩家"}</span>
            <span>模型：${escapeHtml(participant.selectedLabel || "-")}</span>
            <span>本回合：${participant.latestScore}</span>
            <span>最佳：${participant.bestScore}</span>
            <span>總分：${participant.totalScore}</span>
            <span>冠軍：${participant.wins}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderResultsLeaderboard(room) {
  if (!room) {
    els.resultsLeaderboardList.innerHTML = "<p class=\"muted-copy\">等待回合結束後顯示排行榜。</p>";
    return;
  }

  const participantsById = new Map(room.participants.map((participant) => [participant.id, participant]));
  const placedParticipantIds = new Set(room.round.standings.map((entry) => entry.participantId));
  const rankedEntries = room.round.standings.map((entry) => {
    const participant = participantsById.get(entry.participantId);
    return {
      participantId: entry.participantId,
      nickname: entry.nickname,
      placement: entry.placement,
      score: entry.score,
      totalScore: participant?.totalScore || 0,
      wins: participant?.wins || 0,
      bestScore: participant?.bestScore || 0,
      isRequester: Boolean(participant?.isRequester),
    };
  });

  const waitingEntries = room.participants
    .filter((participant) => participant.role === "player" && !placedParticipantIds.has(participant.id))
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }
      if (right.wins !== left.wins) {
        return right.wins - left.wins;
      }
      return right.bestScore - left.bestScore;
    })
    .map((participant, index) => ({
      participantId: participant.id,
      nickname: participant.nickname,
      placement: rankedEntries.length + index + 1,
      score: participant.latestScore,
      totalScore: participant.totalScore,
      wins: participant.wins,
      bestScore: participant.bestScore,
      isRequester: Boolean(participant.isRequester),
      waiting: true,
    }));

  const allEntries = rankedEntries.concat(waitingEntries);
  if (allEntries.length === 0) {
    els.resultsLeaderboardList.innerHTML = "<p class=\"muted-copy\">等待玩家完成本回合後顯示排行榜。</p>";
    return;
  }

  els.resultsLeaderboardList.innerHTML = allEntries
    .map((entry) => {
      const status = entry.waiting ? "等待下一輪" : `本回合 ${entry.score} 分`;
      return `
        <article class="participant-item ${entry.isRequester ? "me" : ""}">
          <div class="participant-topline">
            <div>
              <strong>#${entry.placement} ${escapeHtml(entry.nickname)}</strong>
            </div>
            <strong>${status}</strong>
          </div>
          <div class="participant-meta">
            <span>本回合：${entry.score}</span>
            <span>最佳：${entry.bestScore}</span>
            <span>總分：${entry.totalScore}</span>
            <span>冠軍：${entry.wins}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderHistory(room) {
  if (!room || room.history.length === 0) {
    els.resultsHistoryList.innerHTML = "<p class=\"muted-copy\">回合結束後，這裡會出現歷史排行榜。</p>";
    return;
  }

  els.resultsHistoryList.innerHTML = room.history
    .map((round) => {
      const summary = round.standings.map((entry) => `${entry.placement}. ${escapeHtml(entry.nickname)} (${entry.score})`).join(" / ");
      return `
        <article class="history-item">
          <div class="history-topline">
            <strong>第 ${round.number} 回合</strong>
            <span>${summary || "尚無資料"}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderEvents(element, room) {
  if (!room || room.events.length === 0) {
    element.innerHTML = "<li>尚無事件</li>";
    return;
  }

  element.innerHTML = room.events.map((event) => `<li>${escapeHtml(event.message)}</li>`).join("");
}

function getParticipantBadge(participant) {
  if (participant.role === "host") {
    return { className: "host", text: "主持人" };
  }
  if (participant.activeThisRound && participant.isAlive) {
    return { className: "ready", text: "遊戲中" };
  }
  if (participant.activeThisRound && !participant.isAlive) {
    return { className: "dead", text: "已淘汰" };
  }
  if (participant.readyToRace) {
    return { className: "ready", text: "已就緒" };
  }
  return { className: "waiting", text: "測試中" };
}

function renderLobby(room) {
  const me = room.me;
  const playerCount = room.participants.filter((participant) => participant.role === "player").length;
  const readyCount = room.participants.filter((participant) => participant.readyToRace).length;
  els.lobbyRoomText.textContent = `房間 ${room.id}`;
  els.lobbyPhaseText.textContent = roomPhaseLabel(room);
  els.lobbyPlayerCount.textContent = String(playerCount);
  els.lobbyReadyCount.textContent = String(readyCount);
  els.lobbyMyState.textContent = me ? me.currentState || "等待中" : "等待中";
  els.lobbyModelSummary.textContent =
    state.role === "player"
      ? `目前模型：${state.modelName || "-"}；控制對應：${formatActionLabels() || "尚未設定"}`
      : `主持人可在所有玩家完成測試後開始遊戲。下一回合：${getGameName(room.selectedGameId)}`;

  if (room.phase === "countdown" && room.round.startAt) {
    const remainingSeconds = Math.max(1, Math.ceil((room.round.startAt - getServerNow()) / 1000));
    els.lobbyCountdownText.textContent = `第 ${room.round.number} 回合將在 ${remainingSeconds} 秒後開始。`;
  } else if (room.phase === "running") {
    els.lobbyCountdownText.textContent = `第 ${room.round.number} 回合進行中，存活玩家 ${room.round.aliveCount} 位。`;
  } else if (room.phase === "results") {
    els.lobbyCountdownText.textContent = `回合已結束，請查看排行榜頁。`;
  } else {
    els.lobbyCountdownText.textContent = "玩家完成模型測試後，主持人即可開始。";
  }

  els.hostStartButton.classList.toggle("hidden", !(me && me.role === "host"));
  els.hostStartButton.disabled = !(me && me.role === "host" && room.canStartRound);
  els.hostGameSelectWrap.classList.toggle("hidden", !(me && me.role === "host"));
  syncGameSelectValues(room.selectedGameId);
  renderParticipants(els.lobbyParticipantsList, room);
  renderEvents(els.lobbyEventsList, room);
}

function renderResults(room) {
  const champion = room.round.standings[0];
  els.resultsRoomText.textContent = `房間 ${room.id}`;
  els.resultsRoundText.textContent = `第 ${room.round.number} 回合`;
  els.resultsChampionText.textContent = champion
    ? `本回合冠軍：${champion.nickname}，分數 ${champion.score}`
    : `等待本回合結果，下一回合目前設定為 ${getGameName(room.selectedGameId)}`;
  renderResultsLeaderboard(room);
  renderHistory(room);
  renderEvents(els.resultsEventsList, room);
  els.resultsStartAgainButton.disabled = !(room.me && room.me.role === "host" && room.canStartRound);
  syncGameSelectValues(room.selectedGameId);
  els.resultsReadyHint.textContent = state.lobbyReady
    ? "你目前已維持就緒狀態，主持人可直接再開下一局。"
    : "若要換模型，更新後會回到測試頁重新確認。";
}

function driveViewFromRoom(room) {
  const me = room.me;
  if (!me) {
    return;
  }

  if (room.phase === "countdown" || room.phase === "running") {
    state.preparingNextRound = false;
  }

  if (me.role === "host") {
    if (room.phase === "results" && !state.preparingNextRound) {
      setView("results");
      return;
    }
    if (state.view !== "lobby") {
      setView("lobby");
    }
    return;
  }

  if (me.activeThisRound && (room.phase === "countdown" || room.phase === "running")) {
    setView("game");
    return;
  }

  if (room.phase === "results" && !state.preparingNextRound && state.localGame.roundNumber === room.round.number) {
    setView("results");
    return;
  }

  if (state.view !== "test" && state.view !== "results") {
    setView("lobby");
  }
}

function renderRoom(room) {
  state.latestRoom = room;
  state.serverOffsetMs = room.serverTime - Date.now();
  renderLobby(room);
  renderResults(room);
  driveViewFromRoom(room);
}

function prepareRound(room) {
  if (!room.round.seed || room.round.number === 0) {
    return;
  }
  if (state.localGame.roundNumber === room.round.number && state.localGame.seed === room.round.seed) {
    return;
  }

  state.localGame = createLocalGameState();
  state.localGame.roundNumber = room.round.number;
  state.localGame.seed = room.round.seed;
  state.localGame.gameId = room.round.gameId || room.selectedGameId || "dino_party";
  state.localGame.startAt = room.round.startAt;
  state.localGame.obstacles = createObstacleTimeline(room.round.seed);
  state.localGame.chromeObstacles = createChromeObstacleTimeline(room.round.seed);
  resetSpaceBattleState();
  if (state.localGame.gameId === "chrome_runner") {
    state.localGame.dino.y = state.localGame.physics.groundY - 44;
  }
  state.lastFullscreenRound = 0;
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
  let spawnAt = 2400;

  while (spawnAt < 95_000) {
    const width = 24 + Math.floor(random() * 24);
    const height = 34 + Math.floor(random() * 42);
    obstacles.push({
      spawnAt,
      width,
      height,
    });
    spawnAt += 1650 + Math.floor(random() * 1900);
  }

  return obstacles;
}

function createChromeObstacleTimeline(seed) {
  const random = seededRandom(seed + 73);
  const obstacles = [];
  let spawnAt = 2000;

  while (spawnAt < 95_000) {
    const type = random() > 0.52 ? "ground" : "air";
    obstacles.push({
      spawnAt,
      type,
      width: type === "ground" ? 20 : 40,
      height: type === "ground" ? 38 + Math.floor(random() * 16) : 24,
      yOffset: type === "ground" ? 0 : 45 + Math.floor(random() * 6),
    });
    spawnAt += 1500 + Math.floor(random() * 1700);
  }

  return obstacles;
}

function resetSpaceBattleState() {
  state.localGame.ship = {
    x: 120,
    y: 360,
    size: 40,
    speed: 7,
    cooldown: 0,
    hp: 3,
  };
  state.localGame.asteroids = [];
  state.localGame.lasers = [];
}

function updateLocalGame(deltaMs) {
  const room = state.latestRoom;
  const me = getMyParticipant();

  if (!room || !me || me.role === "host" || !me.activeThisRound) {
    state.localGame.status = "idle";
    return;
  }

  prepareRound(room);

  if (room.phase === "countdown") {
    state.localGame.status = "countdown";
    state.localGame.startAt = room.round.startAt;
    if (state.lastFullscreenRound !== room.round.number) {
      state.lastFullscreenRound = room.round.number;
      tryEnterFullscreen(true);
    }
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

  state.localGame.status = "running";
  const elapsedMs = Math.max(0, getServerNow() - state.localGame.startAt);
  if (state.localGame.gameId === "space_battle") {
    updateSpaceBattle(deltaMs, elapsedMs);
    return;
  }
  if (state.localGame.gameId === "chrome_runner") {
    updateChromeRunner(deltaMs, elapsedMs);
    return;
  }
  updateDinoParty(deltaMs, elapsedMs);
}

function updateDinoParty(deltaMs, elapsedMs) {
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

function updateChromeRunner(deltaMs, elapsedMs) {
  const dt = Math.min(deltaMs, 32) / 16.6667;
  const dino = state.localGame.dino;
  dino.vy += 1.0 * dt;
  dino.y += dino.vy * dt;

  const currentHeight = dino.isCrouching ? 26 : 44;
  const targetGround = state.localGame.physics.groundY - currentHeight;
  if (dino.y >= targetGround) {
    dino.y = targetGround;
    dino.vy = 0;
  }

  state.localGame.chromeSpeedMultiplier = Math.min(3.5, 1 + state.localGame.score / 350);
  state.localGame.score += deltaMs * 0.009;

  if (detectCollision(elapsedMs)) {
    handleLocalDeath();
  }
}

function updateSpaceBattle(deltaMs, elapsedMs) {
  const ship = state.localGame.ship;
  const seconds = deltaMs / 1000;
  state.localGame.score = Math.floor(elapsedMs / 1000);

  if (ship.cooldown > 0) {
    ship.cooldown -= 1;
  }

  const difficultyLevel = Math.floor(state.localGame.score / 30);
  const spawnRateMs = Math.max(450, 1100 - difficultyLevel * 85);
  const currentBucket = Math.floor(elapsedMs / spawnRateMs);
  const previousBucket = Math.floor(Math.max(0, elapsedMs - deltaMs) / spawnRateMs);
  if (currentBucket !== previousBucket) {
    const random = seededRandom((state.localGame.seed || 1) + currentBucket * 13);
    state.localGame.asteroids.push({
      x: els.gameCanvas.width + 90,
      y: 90 + random() * (els.gameCanvas.height - 180),
      speed: 260 + difficultyLevel * 24 + random() * 120,
      size: 34 + random() * 24,
      rotation: random() * Math.PI * 2,
      rotationSpeed: (random() - 0.5) * 0.08,
      hp: 3,
    });
  }

  state.localGame.lasers = state.localGame.lasers
    .map((laser) => ({ ...laser, x: laser.x + laser.speed * seconds }))
    .filter((laser) => laser.x < els.gameCanvas.width + 100);

  for (let i = state.localGame.asteroids.length - 1; i >= 0; i -= 1) {
    const asteroid = state.localGame.asteroids[i];
    asteroid.x -= asteroid.speed * seconds;
    asteroid.rotation += asteroid.rotationSpeed;

    if (Math.hypot(ship.x - asteroid.x, ship.y - asteroid.y) < ship.size * 0.55 + asteroid.size * 0.38) {
      ship.hp -= 1;
      state.localGame.asteroids.splice(i, 1);
      if (ship.hp <= 0) {
        handleLocalDeath();
      }
      continue;
    }

    let destroyed = false;
    for (let j = state.localGame.lasers.length - 1; j >= 0; j -= 1) {
      const laser = state.localGame.lasers[j];
      if (Math.hypot(laser.x - asteroid.x, laser.y - asteroid.y) < asteroid.size * 0.42 + 16) {
        asteroid.hp -= 1;
        state.localGame.lasers.splice(j, 1);
        if (asteroid.hp <= 0) {
          state.localGame.score += 10;
          destroyed = true;
        }
        break;
      }
    }

    if (destroyed || asteroid.x < -120) {
      state.localGame.asteroids.splice(i, 1);
    }
  }
}

function applyPoseCommand() {
  if (state.view !== "game" || state.localGame.status !== "running") {
    state.poseArmed = false;
    return;
  }

  if (state.localGame.gameId === "space_battle") {
    applySpaceBattleCommand();
    return;
  }

  const dino = state.localGame.dino;
  const command = state.currentCommand;

  if (state.localGame.gameId === "chrome_runner") {
    if (command === "jump" && !state.poseArmed && dino.vy === 0) {
      dino.vy = -14;
      dino.isCrouching = false;
      state.poseArmed = true;
      return;
    }
    dino.isCrouching = command === "down" && dino.vy === 0;
    if (command !== "jump") {
      state.poseArmed = false;
    }
    return;
  }

  dino.isCrouching = command === "down" && dino.y === 0;

  if (command === "jump" && !state.poseArmed && dino.y === 0) {
    state.poseArmed = true;
    dino.isCrouching = false;
    dino.vy = state.localGame.physics.jumpVelocity;
    return;
  }

  if (command !== "jump") {
    state.poseArmed = false;
  }
}

function applySpaceBattleCommand() {
  const ship = state.localGame.ship;
  const command = state.currentCommand;

  if (command === "jump") {
    ship.y = Math.max(60, ship.y - ship.speed * 6);
  } else if (command === "down") {
    ship.y = Math.min(els.gameCanvas.height - 60, ship.y + ship.speed * 6);
  }

  if (command === "stay" && !state.poseArmed && ship.cooldown <= 0) {
    state.localGame.lasers.push({
      x: ship.x + 30,
      y: ship.y,
      speed: 720,
    });
    ship.cooldown = 10;
    state.poseArmed = true;
    return;
  }

  if (command !== "stay") {
    state.poseArmed = false;
  }
}

function getDinoRect() {
  const { dino, physics } = state.localGame;
  if (state.localGame.gameId === "chrome_runner") {
    const width = dino.isCrouching ? 75 : 40;
    const height = dino.isCrouching ? 26 : 44;
    return {
      x: 50,
      y: dino.y,
      width,
      height,
    };
  }

  const width = dino.isCrouching ? dino.crouchWidth : dino.standingWidth;
  const height = dino.isCrouching ? dino.crouchHeight : dino.standingHeight;
  return {
    x: dino.x,
    y: physics.groundY - height - dino.y,
    width,
    height,
  };
}

function getObstacleRect(obstacle, elapsedMs) {
  if (state.localGame.gameId === "chrome_runner") {
    const speed = 280 * state.localGame.chromeSpeedMultiplier;
    const timeSinceSpawn = elapsedMs - obstacle.spawnAt;
    if (timeSinceSpawn < -1000) {
      return null;
    }

    const x = els.gameCanvas.width + 40 - (timeSinceSpawn / 1000) * speed;
    if (x < -100 || x > els.gameCanvas.width + 80) {
      return null;
    }

    if (obstacle.type === "ground") {
      return {
        x,
        y: state.localGame.physics.groundY - obstacle.height,
        width: obstacle.width,
        height: obstacle.height,
      };
    }

    return {
      x,
      y: state.localGame.physics.groundY - obstacle.yOffset - obstacle.height,
      width: obstacle.width,
      height: obstacle.height,
    };
  }

  const speed = 420;
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

function detectCollision(elapsedMs) {
  if (state.localGame.gameId === "space_battle") {
    return false;
  }

  const dinoRect = getDinoRect();
  const obstacleList = state.localGame.gameId === "chrome_runner" ? state.localGame.chromeObstacles : state.localGame.obstacles;
  return obstacleList.some((obstacle) => {
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

function drawGround() {
  gameCtx.fillStyle = "#d6b85d";
  gameCtx.fillRect(0, state.localGame.physics.groundY + 4, els.gameCanvas.width, 4);
  gameCtx.fillStyle = "#f7c76d";
  gameCtx.fillRect(0, state.localGame.physics.groundY + 8, els.gameCanvas.width, 10);
}

function drawClouds() {
  gameCtx.fillStyle = "rgba(255,255,255,0.85)";
  [
    [180, 110, 46],
    [520, 72, 34],
    [920, 96, 42],
  ].forEach(([x, y, size]) => {
    gameCtx.beginPath();
    gameCtx.arc(x, y, size, 0, Math.PI * 2);
    gameCtx.arc(x + size * 0.9, y + 6, size * 0.8, 0, Math.PI * 2);
    gameCtx.arc(x + size * 1.6, y, size * 0.7, 0, Math.PI * 2);
    gameCtx.fill();
  });
}

function drawDino() {
  const rect = getDinoRect();
  gameCtx.fillStyle = "#233955";
  if (state.localGame.dino.isCrouching) {
    gameCtx.fillRect(rect.x, rect.y + 18, rect.width, rect.height - 18);
    gameCtx.fillRect(rect.x + rect.width - 22, rect.y + 6, 22, 18);
    gameCtx.fillStyle = "#eef8ff";
    gameCtx.fillRect(rect.x + rect.width - 16, rect.y + 12, 4, 4);
    gameCtx.fillStyle = "#233955";
    gameCtx.fillRect(rect.x + 18, rect.y + rect.height - 4, 10, 10);
    gameCtx.fillRect(rect.x + 52, rect.y + rect.height - 4, 10, 10);
    return;
  }

  gameCtx.fillRect(rect.x, rect.y + 6, rect.width, rect.height - 6);
  gameCtx.fillRect(rect.x + rect.width - 16, rect.y, 16, 18);
  gameCtx.fillStyle = "#eef8ff";
  gameCtx.fillRect(rect.x + rect.width - 11, rect.y + 5, 4, 4);
  gameCtx.fillStyle = "#233955";
  gameCtx.fillRect(rect.x + 10, rect.y + rect.height - 4, 10, 12);
  gameCtx.fillRect(rect.x + 40, rect.y + rect.height - 4, 10, 12);
}

function drawObstacles(elapsedMs) {
  gameCtx.fillStyle = "#3e6a4c";
  state.localGame.obstacles.forEach((obstacle) => {
    const rect = getObstacleRect(obstacle, elapsedMs);
    if (!rect) {
      return;
    }

    gameCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
    gameCtx.fillRect(rect.x + rect.width * 0.38, rect.y - rect.height * 0.42, 12, rect.height * 0.42);
  });
}

function drawChromeRunnerScene(elapsedMs) {
  gameCtx.fillStyle = "#f7f7f7";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);

  gameCtx.strokeStyle = "#535353";
  gameCtx.lineWidth = 4;
  gameCtx.beginPath();
  gameCtx.moveTo(0, state.localGame.physics.groundY);
  gameCtx.lineTo(els.gameCanvas.width, state.localGame.physics.groundY);
  gameCtx.stroke();

  drawChromeDino();
  drawChromeObstacles(elapsedMs);
}

function drawChromeDino() {
  const rect = getDinoRect();
  gameCtx.fillStyle = "#535353";
  if (state.localGame.dino.isCrouching) {
    gameCtx.fillRect(rect.x, rect.y, 55, 26);
    gameCtx.fillRect(rect.x + 55, rect.y + 5, 20, 15);
    gameCtx.fillStyle = "#f7f7f7";
    gameCtx.fillRect(rect.x + 62, rect.y + 8, 4, 4);
    return;
  }

  gameCtx.fillRect(rect.x, rect.y + 10, 24, 34);
  gameCtx.fillRect(rect.x - 8, rect.y + 15, 8, 10);
  gameCtx.fillRect(rect.x + 20, rect.y, 20, 22);
  gameCtx.fillStyle = "#f7f7f7";
  gameCtx.fillRect(rect.x + 25, rect.y + 4, 4, 4);
  gameCtx.fillStyle = "#535353";
  const legOffset = state.localGame.status === "running" && state.localGame.dino.vy === 0 && performance.now() % 200 < 100 ? 4 : 0;
  gameCtx.fillRect(rect.x + 4, rect.y + 44, 6, 6 - legOffset);
  gameCtx.fillRect(rect.x + 14, rect.y + 44, 6, 6 + legOffset);
}

function drawChromeObstacles(elapsedMs) {
  gameCtx.fillStyle = "#535353";
  state.localGame.chromeObstacles.forEach((obstacle) => {
    const rect = getObstacleRect(obstacle, elapsedMs);
    if (!rect) {
      return;
    }

    if (obstacle.type === "ground") {
      gameCtx.fillRect(rect.x + 6, rect.y, 8, rect.height);
      gameCtx.fillRect(rect.x, rect.y + 10, 6, 15);
      gameCtx.fillRect(rect.x + 14, rect.y + 15, 6, 12);
      return;
    }

    const flapUp = Math.floor(elapsedMs / 180) % 2 === 0;
    gameCtx.fillRect(rect.x + 10, rect.y + 10, 20, 8);
    gameCtx.fillRect(rect.x + 30, rect.y + 8, 10, 6);
    if (flapUp) {
      gameCtx.fillRect(rect.x + 14, rect.y, 14, 10);
    } else {
      gameCtx.fillRect(rect.x + 14, rect.y + 18, 14, 10);
    }
  });
}

function drawSpaceBattleScene(elapsedMs) {
  gameCtx.fillStyle = "#0f172a";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);

  gameCtx.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < 80; i += 1) {
    const x = (i * 173 + elapsedMs * 0.08) % els.gameCanvas.width;
    const y = (i * 97) % els.gameCanvas.height;
    gameCtx.fillRect(els.gameCanvas.width - x, y, (i % 3) + 1, (i % 3) + 1);
  }

  drawSpaceship();
  drawLasers();
  drawAsteroids();
  drawSpaceBattleHud();
}

function drawSpaceship() {
  const ship = state.localGame.ship;
  gameCtx.font = "48px Avenir Next";
  gameCtx.textAlign = "center";
  gameCtx.textBaseline = "middle";
  gameCtx.fillText("🚀", ship.x, ship.y);
}

function drawLasers() {
  state.localGame.lasers.forEach((laser) => {
    gameCtx.fillStyle = "#06b6d4";
    gameCtx.fillRect(laser.x, laser.y - 4, 26, 8);
    gameCtx.fillStyle = "#ffffff";
    gameCtx.fillRect(laser.x + 5, laser.y - 2, 16, 4);
  });
}

function drawAsteroids() {
  state.localGame.asteroids.forEach((asteroid) => {
    gameCtx.save();
    gameCtx.translate(asteroid.x, asteroid.y);
    gameCtx.rotate(asteroid.rotation);
    gameCtx.font = `${Math.max(28, asteroid.size)}px Avenir Next`;
    gameCtx.textAlign = "center";
    gameCtx.textBaseline = "middle";
    gameCtx.fillText("🪨", 0, 0);
    gameCtx.restore();
  });
}

function drawSpaceBattleHud() {
  const ship = state.localGame.ship;
  gameCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, 78);
  gameCtx.fillStyle = "#ffffff";
  gameCtx.font = "18px Avenir Next";
  gameCtx.textAlign = "left";
  gameCtx.fillText(`❤️ ${"❤️ ".repeat(Math.max(0, ship.hp)).trim() || "0"}`, 24, 28);
  gameCtx.fillStyle = "#38bdf8";
  gameCtx.fillText(`AI: ${state.currentPose || "WAITING"} (${(state.currentConfidence * 100).toFixed(0)}%)`, 24, 56);
  gameCtx.fillStyle = "#fbbf24";
  gameCtx.textAlign = "right";
  gameCtx.fillText(`分數 ${state.localGame.score}`, els.gameCanvas.width - 24, 42);
}

function drawOverlay(title, subtitle) {
  gameCtx.fillStyle = "rgba(8, 18, 30, 0.28)";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  gameCtx.fillStyle = "rgba(255, 255, 255, 0.96)";
  gameCtx.font = "700 84px Avenir Next";
  gameCtx.fillText(title, 70, 160);
  gameCtx.fillStyle = "rgba(255, 255, 255, 0.82)";
  gameCtx.font = "700 44px Avenir Next";
  gameCtx.fillText(subtitle, 74, 230);
}

function drawIdleGame(message, subtitle) {
  gameCtx.clearRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  gameCtx.fillStyle = "#eef8ff";
  gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
  drawClouds();
  drawGround();
  gameCtx.fillStyle = "#1c3556";
  gameCtx.font = "700 56px Avenir Next";
  gameCtx.fillText(message, 56, 108);
  gameCtx.fillStyle = "#64748b";
  gameCtx.font = "30px Avenir Next";
  gameCtx.fillText(subtitle, 56, 154);
}

function renderGame() {
  const room = state.latestRoom;
  const me = getMyParticipant();
  els.gameRoomText.textContent = `房間 ${state.roomId || "-"}`;
  els.gameRoundText.textContent = `第 ${state.localGame.roundNumber || 0} 回合`;
  els.gameScenarioText.textContent = getGameName(state.localGame.gameId || room?.round?.gameId || room?.selectedGameId || "dino_party");
  els.gameStateText.textContent = room ? roomPhaseLabel(room) : "等待開始";
  els.gameScoreText.textContent = `分數 ${state.localGame.score || 0}`;
  els.gameFullscreenButton.classList.toggle("hidden", !state.needsFullscreenButton);

  if (!room || !me || me.role === "host" || !me.activeThisRound) {
    els.gameBanner.textContent = state.role === "host" ? "主持人控制等待室即可" : "等待主持人開始";
    drawIdleGame(getGameName(state.localGame.gameId || room?.selectedGameId || "dino_party"), "等待主持人開始本回合");
    return;
  }

  const elapsedMs = Math.max(0, getServerNow() - state.localGame.startAt);
  if (state.localGame.gameId === "space_battle") {
    drawSpaceBattleScene(elapsedMs);
  } else if (state.localGame.gameId === "chrome_runner") {
    drawChromeRunnerScene(elapsedMs);
  } else {
    gameCtx.clearRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
    gameCtx.fillStyle = "#eef8ff";
    gameCtx.fillRect(0, 0, els.gameCanvas.width, els.gameCanvas.height);
    drawClouds();
    drawGround();
    drawObstacles(elapsedMs);
    drawDino();
  }

  if (state.localGame.status === "countdown") {
    const remainingMs = Math.max(0, state.localGame.startAt - getServerNow());
    const countdown = Math.max(1, Math.ceil(remainingMs / 1000));
    els.gameBanner.textContent = `${getGameName(state.localGame.gameId)} ${countdown} 秒後開始`;
    drawOverlay("準備起跑", `${countdown}`);
    return;
  }

  if (state.localGame.status === "dead") {
    els.gameBanner.textContent = `你已淘汰，分數 ${state.localGame.score}`;
    drawOverlay("本回合淘汰", `你的分數 ${state.localGame.score}`);
    return;
  }

  if (room.phase === "results") {
    els.gameBanner.textContent = `回合結束，你的分數 ${state.localGame.score}`;
    drawOverlay("回合結束", `你的分數 ${state.localGame.score}`);
    return;
  }

  els.gameBanner.textContent = `${getGameName(state.localGame.gameId)} 進行中`;
}

async function tryEnterFullscreen(announce) {
  if (state.role !== "player" || state.view !== "game") {
    return;
  }

  if (document.fullscreenElement) {
    state.needsFullscreenButton = false;
    return;
  }

  try {
    await document.documentElement.requestFullscreen();
    state.needsFullscreenButton = false;
  } catch (error) {
    console.warn("Fullscreen request failed", error);
    state.needsFullscreenButton = true;
    if (announce) {
      setStatus("瀏覽器擋下自動全螢幕，請按右上角「進入全螢幕」", "warn");
    }
  }
}

function syncModelInputs(value) {
  els.modelUrlInput.value = value;
  els.resultsModelUrlInput.value = value;
  savePreferences();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.roleSelect.addEventListener("change", () => {
  updateRoleUI();
  savePreferences();
});
els.nicknameInput.addEventListener("input", () => {
  refreshSetupButtonState();
  savePreferences();
});
els.roomInput.addEventListener("input", () => {
  refreshSetupButtonState();
  savePreferences();
});
els.modelUrlInput.addEventListener("input", () => {
  refreshSetupButtonState();
  els.resultsModelUrlInput.value = els.modelUrlInput.value.trim();
  savePreferences();
});
els.thresholdInput.addEventListener("input", updateThreshold);
els.jumpLabelSelect.addEventListener("change", syncActionLabelsFromInputs);
els.stayLabelSelect.addEventListener("change", syncActionLabelsFromInputs);
els.downLabelSelect.addEventListener("change", syncActionLabelsFromInputs);
els.enterRoomButton.addEventListener("click", handleEnterRoom);
els.backToSetupButton.addEventListener("click", () => {
  state.lobbyReady = false;
  setView("setup");
  setStatus("你可以重新設定名稱、房間或模型 URL");
});
els.goToLobbyButton.addEventListener("click", () => {
  confirmTestAndGoLobby().catch((error) => {
    console.error(error);
    setStatus(`進入等待室失敗：${error.message}`, "error");
  });
});
els.lobbyRetestButton.addEventListener("click", () => {
  goBackToTestingFromRoom().catch((error) => {
    console.error(error);
    setStatus(`返回測試頁失敗：${error.message}`, "error");
  });
});
els.hostStartButton.addEventListener("click", startRound);
els.hostGameSelect.addEventListener("change", () => {
  updateRoomGame(els.hostGameSelect.value).catch((error) => {
    console.error(error);
    setStatus(`切換遊戲失敗：${error.message}`, "error");
  });
});
els.resultsRetestButton.addEventListener("click", () => {
  goBackToTestingFromRoom().catch((error) => {
    console.error(error);
    setStatus(`返回測試頁失敗：${error.message}`, "error");
  });
});
els.resultsUpdateModelButton.addEventListener("click", updateModelFromResults);
els.resultsGameSelect.addEventListener("change", () => {
  updateRoomGame(els.resultsGameSelect.value).catch((error) => {
    console.error(error);
    setStatus(`切換遊戲失敗：${error.message}`, "error");
  });
});
els.resultsStartAgainButton.addEventListener("click", startRound);
els.gameFullscreenButton.addEventListener("click", () => {
  tryEnterFullscreen(false).catch((error) => {
    console.error(error);
    setStatus(`進入全螢幕失敗：${error.message}`, "error");
  });
});
document.addEventListener("fullscreenchange", () => {
  state.needsFullscreenButton = !document.fullscreenElement && state.view === "game";
});

restorePreferences();
populateGameSelects();
state.threshold = Number(els.thresholdInput.value);
updateRoleUI();
updateThreshold();
refreshTestingButtonState();
renderPredictionList();
renderPoseMetrics();
drawCameraPlaceholder();
setView("setup");
setStatus("請先輸入名稱、房間與模型 URL；進入房間後會自動開啟模型測試");
startAnimationLoop();
