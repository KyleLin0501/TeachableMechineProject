const state = {
  playerId: localStorage.getItem("tm_pose_battle_player_id") || crypto.randomUUID(),
  apiBaseUrl: resolveApiBaseUrl(),
  nickname: "",
  roomId: "",
  modelUrl: "",
  modelName: "",
  model: null,
  webcam: null,
  ctx: null,
  maxPredictions: 0,
  labels: [],
  selectedLabel: "",
  threshold: 0.9,
  joined: false,
  pollTimer: null,
  syncTimer: null,
  currentPose: "",
  currentConfidence: 0,
  attackArmed: false,
  latestRoom: null,
};

localStorage.setItem("tm_pose_battle_player_id", state.playerId);

const els = {
  nicknameInput: document.getElementById("nicknameInput"),
  roomInput: document.getElementById("roomInput"),
  modelUrlInput: document.getElementById("modelUrlInput"),
  labelSelect: document.getElementById("labelSelect"),
  thresholdInput: document.getElementById("thresholdInput"),
  thresholdValue: document.getElementById("thresholdValue"),
  loadModelButton: document.getElementById("loadModelButton"),
  cameraButton: document.getElementById("cameraButton"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  resetButton: document.getElementById("resetButton"),
  apiBaseUrlText: document.getElementById("apiBaseUrlText"),
  statusText: document.getElementById("statusText"),
  currentPoseText: document.getElementById("currentPoseText"),
  currentConfidenceText: document.getElementById("currentConfidenceText"),
  roomStatusText: document.getElementById("roomStatusText"),
  phaseText: document.getElementById("phaseText"),
  meName: document.getElementById("meName"),
  opponentName: document.getElementById("opponentName"),
  meHpBar: document.getElementById("meHpBar"),
  opponentHpBar: document.getElementById("opponentHpBar"),
  meHpText: document.getElementById("meHpText"),
  opponentHpText: document.getElementById("opponentHpText"),
  meSkillText: document.getElementById("meSkillText"),
  opponentSkillText: document.getElementById("opponentSkillText"),
  winnerText: document.getElementById("winnerText"),
  eventLog: document.getElementById("eventLog"),
  canvas: document.getElementById("canvas"),
};

state.ctx = els.canvas.getContext("2d");

function resolveApiBaseUrl() {
  const rawValue = window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE_URL === "string"
    ? window.APP_CONFIG.API_BASE_URL
    : "";

  return rawValue.trim().replace(/\/+$/, "");
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function getApiUrl(path) {
  return `${state.apiBaseUrl}${path}`;
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
    els.cameraButton.disabled = false;
    els.joinRoomButton.disabled = false;
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
    const size = 480;
    state.webcam = new tmPose.Webcam(size, size, true);
    await state.webcam.setup();
    await state.webcam.play();

    els.canvas.width = size;
    els.canvas.height = size;

    window.requestAnimationFrame(loop);
    setStatus("鏡頭已啟動，請做出你的攻擊姿勢");
  } catch (error) {
    console.error(error);
    setStatus(`鏡頭啟動失敗：${error.message}`);
  }
}

async function predict() {
  if (!state.model || !state.webcam) {
    return;
  }

  const { pose, posenetOutput } = await state.model.estimatePose(state.webcam.canvas);
  const predictions = await state.model.predict(posenetOutput);
  const best = predictions.reduce((top, item) => (item.probability > top.probability ? item : top), predictions[0]);

  state.currentPose = best.className;
  state.currentConfidence = best.probability;

  els.currentPoseText.textContent = state.currentPose || "未辨識";
  els.currentConfidenceText.textContent = state.currentConfidence.toFixed(2);

  drawCanvas(pose);
  evaluateAttackTrigger();
}

function drawCanvas(pose) {
  if (!state.webcam || !state.ctx) {
    return;
  }

  state.ctx.drawImage(state.webcam.canvas, 0, 0);
  if (pose) {
    const minPartConfidence = 0.5;
    tmPose.drawKeypoints(pose.keypoints, minPartConfidence, state.ctx);
    tmPose.drawSkeleton(pose.keypoints, minPartConfidence, state.ctx);
  }
}

function evaluateAttackTrigger() {
  if (!state.joined || !state.selectedLabel) {
    return;
  }

  const isActive =
    state.currentPose === state.selectedLabel &&
    state.currentConfidence >= state.threshold &&
    state.latestRoom &&
    state.latestRoom.phase === "active";

  if (isActive && !state.attackArmed) {
    state.attackArmed = true;
    syncPlayer(true).catch((error) => {
      console.error(error);
      setStatus(`同步攻擊失敗：${error.message}`);
    });
  } else if (!isActive) {
    state.attackArmed = false;
  }
}

async function loop() {
  if (!state.webcam) {
    return;
  }

  state.webcam.update();
  await predict();
  window.requestAnimationFrame(loop);
}

function battlePhaseText(phase, winnerId) {
  if (phase === "active") return "對戰中";
  if (phase === "finished") return winnerId === state.playerId ? "你獲勝了" : "對手獲勝";
  return "等待中";
}

function updateHpBar(element, hp) {
  const safeHp = Math.max(0, Math.min(100, Number(hp || 0)));
  element.style.width = `${safeHp}%`;
  element.style.background =
    safeHp > 60
      ? "linear-gradient(90deg, #0c9b68, #58d79a)"
      : safeHp > 30
        ? "linear-gradient(90deg, #d89a00, #ffcc4d)"
        : "linear-gradient(90deg, #d94b4b, #ff8f8f)";
}

function renderRoom(room) {
  state.latestRoom = room;
  const me = room.me;
  const opponent = room.opponent;

  els.roomStatusText.textContent = room.id || "未連線";
  els.phaseText.textContent = battlePhaseText(room.phase, room.winnerId);
  els.winnerText.textContent =
    room.phase === "finished"
      ? room.winnerId === state.playerId
        ? "本回合由你獲勝"
        : "本回合由對手獲勝"
      : "尚未分出勝負";

  els.meName.textContent = me?.nickname || "未加入";
  els.meHpText.textContent = `HP ${me?.hp ?? 100}`;
  els.meSkillText.textContent = `攻擊姿勢：${me?.selectedLabel || "-"}`;
  updateHpBar(els.meHpBar, me?.hp ?? 100);

  els.opponentName.textContent = opponent?.nickname || "等待對手加入";
  els.opponentHpText.textContent = `HP ${opponent?.hp ?? 100}`;
  els.opponentSkillText.textContent = `攻擊姿勢：${opponent?.selectedLabel || "-"}`;
  updateHpBar(els.opponentHpBar, opponent?.hp ?? 100);

  els.eventLog.innerHTML = "";
  room.events.forEach((event) => {
    const li = document.createElement("li");
    li.textContent = event.message;
    els.eventLog.appendChild(li);
  });
}

async function joinRoom() {
  try {
    if (!state.model) {
      throw new Error("請先載入模型");
    }

    state.nickname = els.nicknameInput.value.trim() || "Player";
    state.roomId = els.roomInput.value.trim();
    state.selectedLabel = els.labelSelect.value;

    if (!state.roomId) {
      throw new Error("請輸入房間號碼");
    }

    await api("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({
        roomId: state.roomId,
        playerId: state.playerId,
        nickname: state.nickname,
      }),
    });

    state.joined = true;
    els.resetButton.disabled = false;
    setStatus(`已加入房間 ${state.roomId}，等待同步中...`);
    await syncPlayer(false);
    startPolling();
  } catch (error) {
    console.error(error);
    setStatus(`加入房間失敗：${error.message}`);
  }
}

function startPolling() {
  stopPolling();

  state.pollTimer = window.setInterval(async () => {
    if (!state.roomId || !state.playerId) {
      return;
    }

    try {
      const data = await api(
        `/api/rooms/state?roomId=${encodeURIComponent(state.roomId)}&playerId=${encodeURIComponent(state.playerId)}`
      );
      renderRoom(data.room);
    } catch (error) {
      console.error(error);
      setStatus(`房間同步失敗：${error.message}`);
    }
  }, 800);

  state.syncTimer = window.setInterval(() => {
    syncPlayer(false).catch((error) => {
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

async function syncPlayer(attackPulse) {
  if (!state.joined || !state.roomId) {
    return;
  }

  state.selectedLabel = els.labelSelect.value;

  const data = await api("/api/rooms/update", {
    method: "POST",
    body: JSON.stringify({
      roomId: state.roomId,
      playerId: state.playerId,
      nickname: els.nicknameInput.value.trim() || "Player",
      modelUrl: state.modelUrl,
      modelName: state.modelName,
      labels: state.labels,
      selectedLabel: state.selectedLabel,
      currentLabel: state.currentPose,
      currentConfidence: state.currentConfidence,
      attackPulse,
    }),
  });

  renderRoom(data.room);
}

async function resetBattle() {
  try {
    await api("/api/rooms/update", {
      method: "POST",
      body: JSON.stringify({
        roomId: state.roomId,
        playerId: state.playerId,
        resetBattle: true,
      }),
    });
    setStatus("已送出重置要求");
  } catch (error) {
    console.error(error);
    setStatus(`重置失敗：${error.message}`);
  }
}

els.loadModelButton.addEventListener("click", loadModel);
els.cameraButton.addEventListener("click", startCamera);
els.joinRoomButton.addEventListener("click", joinRoom);
els.resetButton.addEventListener("click", resetBattle);
els.labelSelect.addEventListener("change", () => {
  state.selectedLabel = els.labelSelect.value;
});
els.thresholdInput.addEventListener("input", updateThreshold);

updateThreshold();
els.apiBaseUrlText.textContent = state.apiBaseUrl || `${window.location.origin} (same-origin)`;
setStatus("請先輸入模型 URL 並載入模型");
