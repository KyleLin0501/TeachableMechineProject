const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const STALE_PLAYER_MS = 180_000;
const COUNTDOWN_MS = 5000;
const DEFAULT_GAME_ID = "dino_party";
const GAME_IDS = new Set(["dino_party", "space_battle", "chrome_runner"]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const rooms = new Map();

function now() {
  return Date.now();
}

function sanitizeText(value, fallback, maxLength = 40) {
  const trimmed = String(value || "").trim();
  return trimmed.slice(0, maxLength) || fallback;
}

function isPlayerReady(player) {
  if (!player || player.role === "host") {
    return false;
  }

  return Boolean(player.modelUrl && player.selectedLabel && player.cameraReady && player.lobbyReady);
}

function setCorsHeaders(req, res) {
  const requestOrigin = req.headers.origin;

  if (ALLOWED_ORIGINS.length === 0) {
    if (requestOrigin) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Vary", "Origin");
    }
    return;
  }

  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  }
}

function sendJson(req, res, statusCode, payload) {
  setCorsHeaders(req, res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function createParticipant({ participantId, nickname, role }) {
  return {
    id: participantId,
    role: role === "host" ? "host" : "player",
    nickname: sanitizeText(nickname, role === "host" ? "主持人" : "玩家", 24),
    joinedAt: now(),
    lastSeenAt: now(),
    modelUrl: "",
    modelName: "",
    labels: [],
    selectedLabel: "",
    cameraReady: false,
    lobbyReady: false,
    currentLabel: "",
    currentConfidence: 0,
    currentDistance: 0,
    currentState: "idle",
    activeThisRound: false,
    isAlive: false,
    latestScore: 0,
    bestScore: 0,
    totalScore: 0,
    wins: 0,
    roundsPlayed: 0,
    eliminatedAt: 0,
  };
}

function createRoom(roomId) {
  return {
    id: roomId,
    createdAt: now(),
    hostId: null,
    phase: "lobby",
    selectedGameId: DEFAULT_GAME_ID,
    participants: {},
    participantOrder: [],
    lastEventId: 0,
    events: [],
    history: [],
    round: {
      number: 0,
      seed: null,
      gameId: DEFAULT_GAME_ID,
      startAt: null,
      countdownMs: COUNTDOWN_MS,
      activeParticipantIds: [],
      standings: [],
      endedAt: null,
    },
  };
}

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId));
  }

  return rooms.get(roomId);
}

function addEvent(room, message, type = "info") {
  room.lastEventId += 1;
  room.events.push({
    id: room.lastEventId,
    type,
    message,
    createdAt: now(),
  });

  if (room.events.length > 50) {
    room.events.shift();
  }
}

function assignHostIfNeeded(room) {
  const currentHost = room.hostId ? room.participants[room.hostId] : null;
  if (currentHost && currentHost.role === "host") {
    return;
  }

  const explicitHost = room.participantOrder
    .map((participantId) => room.participants[participantId])
    .find((participant) => participant && participant.role === "host");

  if (explicitHost) {
    room.hostId = explicitHost.id;
    return;
  }

  const fallbackHost = room.participantOrder
    .map((participantId) => room.participants[participantId])
    .find(Boolean);

  room.hostId = fallbackHost ? fallbackHost.id : null;
}

function getRoundParticipants(room) {
  return room.round.activeParticipantIds
    .map((participantId) => room.participants[participantId])
    .filter(Boolean);
}

function finalizeRound(room) {
  const activeParticipants = getRoundParticipants(room);
  if (activeParticipants.length === 0) {
    room.phase = "lobby";
    room.round.seed = null;
    room.round.startAt = null;
    room.round.standings = [];
    room.round.endedAt = now();
    return;
  }

  const standings = [...activeParticipants]
    .sort((left, right) => {
      if (right.latestScore !== left.latestScore) {
        return right.latestScore - left.latestScore;
      }
      return right.eliminatedAt - left.eliminatedAt;
    })
    .map((participant, index) => ({
      participantId: participant.id,
      nickname: participant.nickname,
      score: participant.latestScore,
      placement: index + 1,
    }));

  standings.forEach((entry, index) => {
    const participant = room.participants[entry.participantId];
    if (!participant) {
      return;
    }

    participant.roundsPlayed += 1;
    participant.totalScore += entry.score;
    participant.bestScore = Math.max(participant.bestScore, entry.score);

    if (index === 0) {
      participant.wins += 1;
    }
  });

  room.phase = "results";
  room.round.standings = standings;
  room.round.endedAt = now();
  room.history.unshift({
    number: room.round.number,
    startedAt: room.round.startAt,
    endedAt: room.round.endedAt,
    standings,
  });

  if (room.history.length > 12) {
    room.history.pop();
  }

  const champion = standings[0];
  if (champion) {
    addEvent(room, `第 ${room.round.number} 回合結束，${champion.nickname} 奪冠`, "finish");
  }
}

function refreshRoomLifecycle(room) {
  assignHostIfNeeded(room);

  if (room.phase === "countdown" && room.round.startAt && now() >= room.round.startAt) {
    room.phase = "running";
    addEvent(room, `第 ${room.round.number} 回合同步開跑`, "start");
  }

  if (room.phase === "running") {
    const activeParticipants = getRoundParticipants(room);
    const aliveParticipants = activeParticipants.filter((participant) => participant.isAlive);

    if (activeParticipants.length === 0 || aliveParticipants.length === 0) {
      finalizeRound(room);
    }
  }
}

function cleanupRooms() {
  const staleThreshold = now() - STALE_PLAYER_MS;

  for (const [roomId, room] of rooms.entries()) {
    room.participantOrder = room.participantOrder.filter((participantId) => {
      const participant = room.participants[participantId];
      if (!participant) {
        return false;
      }

      if (participant.lastSeenAt < staleThreshold) {
        const wasAlive = participant.activeThisRound && participant.isAlive;
        delete room.participants[participantId];
        addEvent(room, `${participant.nickname} 已離線`, "leave");

        if (wasAlive) {
          refreshRoomLifecycle(room);
        }

        return false;
      }

      return true;
    });

    assignHostIfNeeded(room);
    refreshRoomLifecycle(room);

    if (room.participantOrder.length === 0) {
      rooms.delete(roomId);
    }
  }
}

function participantSummary(participant, requesterId) {
  return {
    id: participant.id,
    role: participant.role,
    nickname: participant.nickname,
    modelName: participant.modelName,
    selectedLabel: participant.selectedLabel,
    cameraReady: participant.cameraReady,
    lobbyReady: participant.lobbyReady,
    readyToRace: isPlayerReady(participant),
    currentLabel: participant.currentLabel,
    currentConfidence: participant.currentConfidence,
    currentDistance: participant.currentDistance,
    currentState: participant.currentState,
    activeThisRound: participant.activeThisRound,
    isAlive: participant.isAlive,
    latestScore: participant.latestScore,
    bestScore: participant.bestScore,
    totalScore: participant.totalScore,
    wins: participant.wins,
    roundsPlayed: participant.roundsPlayed,
    isRequester: participant.id === requesterId,
    lastSeenAt: participant.lastSeenAt,
  };
}

function roomSummary(room, requesterId) {
  refreshRoomLifecycle(room);

  const participants = room.participantOrder
    .map((participantId) => room.participants[participantId])
    .filter(Boolean)
    .map((participant) => participantSummary(participant, requesterId));

  const readyPlayers = participants.filter((participant) => participant.readyToRace).length;
  const activePlayers = participants.filter((participant) => participant.activeThisRound);
  const me = participants.find((participant) => participant.id === requesterId) || null;
  const host = participants.find((participant) => participant.id === room.hostId) || null;

  return {
    id: room.id,
    phase: room.phase,
    hostId: room.hostId,
    selectedGameId: room.selectedGameId,
    playerCount: participants.filter((participant) => participant.role === "player").length,
    readyPlayerCount: readyPlayers,
    me,
    host,
    participants,
    round: {
      number: room.round.number,
      seed: room.round.seed,
      gameId: room.round.gameId,
      startAt: room.round.startAt,
      countdownMs: room.round.countdownMs,
      activeParticipantIds: room.round.activeParticipantIds,
      standings: room.round.standings,
      endedAt: room.round.endedAt,
      aliveCount: activePlayers.filter((participant) => participant.isAlive).length,
    },
    history: room.history,
    events: room.events.slice(-12),
    canStartRound: room.phase !== "countdown" && room.phase !== "running" && readyPlayers > 0,
    serverTime: now(),
  };
}

function updateParticipantPresence(participant, body) {
  participant.nickname = sanitizeText(body.nickname, participant.nickname, 24);
  participant.modelUrl = sanitizeText(body.modelUrl, participant.modelUrl, 200);
  participant.modelName = sanitizeText(body.modelName, participant.modelName, 40);
  participant.labels = Array.isArray(body.labels) ? body.labels.map((label) => sanitizeText(label, "", 40)).filter(Boolean) : participant.labels;
  participant.selectedLabel = sanitizeText(body.selectedLabel, participant.selectedLabel, 40);
  participant.cameraReady = Boolean(body.cameraReady);
  participant.lobbyReady = Boolean(body.lobbyReady);
  participant.currentLabel = sanitizeText(body.currentLabel, "", 40);
  participant.currentConfidence = Number(body.currentConfidence || 0);
  participant.lastSeenAt = now();
}

function updateRoundProgress(room, participant, body) {
  if (!participant.activeThisRound || room.phase === "lobby" || room.phase === "results") {
    return;
  }

  const reportedRoundNumber = Number(body.roundNumber || 0);
  if (reportedRoundNumber !== room.round.number) {
    return;
  }

  participant.currentDistance = Math.max(participant.currentDistance, Number(body.currentDistance || 0));
  participant.latestScore = Math.max(participant.latestScore, Number(body.latestScore || 0), participant.currentDistance);
  participant.currentState = sanitizeText(body.currentState, participant.currentState, 24);

  if (body.reportDeath === true && participant.isAlive) {
    participant.isAlive = false;
    participant.eliminatedAt = now();
    participant.currentState = "dead";
    addEvent(room, `${participant.nickname} 在第 ${room.round.number} 回合淘汰，得分 ${participant.latestScore}`, "elimination");
  }
}

function startRound(room, hostId) {
  const host = room.participants[hostId];
  if (!host || host.id !== room.hostId) {
    throw new Error("Only the host can start a round");
  }

  const readyParticipants = room.participantOrder
    .map((participantId) => room.participants[participantId])
    .filter((participant) => participant && isPlayerReady(participant));

  if (readyParticipants.length === 0) {
    throw new Error("No ready players in the room");
  }

  room.phase = "countdown";
  room.round.number += 1;
  room.round.seed = Math.floor(Math.random() * 1_000_000_000);
  room.round.gameId = room.selectedGameId || DEFAULT_GAME_ID;
  room.round.startAt = now() + COUNTDOWN_MS;
  room.round.countdownMs = COUNTDOWN_MS;
  room.round.activeParticipantIds = readyParticipants.map((participant) => participant.id);
  room.round.standings = [];
  room.round.endedAt = null;

  room.participantOrder.forEach((participantId) => {
    const participant = room.participants[participantId];
    if (!participant) {
      return;
    }

    participant.currentDistance = 0;
    participant.currentState = participant.role === "host" ? "hosting" : "waiting";
    participant.latestScore = 0;
    participant.eliminatedAt = 0;
    participant.activeThisRound = room.round.activeParticipantIds.includes(participant.id);
    participant.isAlive = participant.activeThisRound;
  });

  addEvent(
    room,
    `主持人已啟動第 ${room.round.number} 回合（${room.round.gameId}），${readyParticipants.length} 位玩家準備出發`,
    "countdown"
  );
}

function resetLeaderboard(room, hostId) {
  const host = room.participants[hostId];
  if (!host || host.id !== room.hostId) {
    throw new Error("Only the host can reset the leaderboard");
  }

  room.phase = "lobby";
  room.history = [];
  room.round = {
    number: 0,
    seed: null,
    gameId: room.selectedGameId || DEFAULT_GAME_ID,
    startAt: null,
    countdownMs: COUNTDOWN_MS,
    activeParticipantIds: [],
    standings: [],
    endedAt: null,
  };

  room.participantOrder.forEach((participantId) => {
    const participant = room.participants[participantId];
    if (!participant) {
      return;
    }

    participant.currentDistance = 0;
    participant.currentState = "idle";
    participant.activeThisRound = false;
    participant.isAlive = false;
    participant.latestScore = 0;
    participant.bestScore = 0;
    participant.totalScore = 0;
    participant.wins = 0;
    participant.roundsPlayed = 0;
    participant.eliminatedAt = 0;
  });

  addEvent(room, "主持人已重置整個賽季分數", "reset");
}

function setRoomGame(room, hostId, gameId) {
  const host = room.participants[hostId];
  if (!host || host.id !== room.hostId) {
    throw new Error("Only the host can change the game");
  }

  if (!GAME_IDS.has(gameId)) {
    throw new Error("Unsupported game id");
  }

  room.selectedGameId = gameId;
  addEvent(room, `主持人已將下一回合遊戲切換為 ${gameId}`, "config");
}

async function handleApi(req, res, pathname, searchParams) {
  cleanupRooms();

  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    setCorsHeaders(req, res);
    res.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return true;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(req, res, 200, { ok: true, rooms: rooms.size, time: now() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/join") {
    const body = await readJson(req);
    const roomId = sanitizeText(body.roomId, "", 32);
    const participantId = sanitizeText(body.participantId, "", 80);
    const role = body.role === "host" ? "host" : "player";

    if (!roomId || !participantId) {
      sendJson(req, res, 400, { error: "roomId and participantId are required" });
      return true;
    }

    const room = ensureRoom(roomId);
    let participant = room.participants[participantId];

    if (!participant) {
      participant = createParticipant({
        participantId,
        nickname: body.nickname,
        role,
      });
      room.participants[participantId] = participant;
      room.participantOrder.push(participantId);
      addEvent(room, `${participant.nickname}${participant.role === "host" ? " 以主持人身份" : ""}加入房間`, "join");
    } else {
      participant.role = role;
      participant.nickname = sanitizeText(body.nickname, participant.nickname, 24);
      participant.lastSeenAt = now();
    }

    if (!room.hostId || role === "host") {
      room.hostId = participantId;
    }

    sendJson(req, res, 200, { ok: true, room: roomSummary(room, participantId) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/update") {
    const body = await readJson(req);
    const roomId = sanitizeText(body.roomId, "", 32);
    const participantId = sanitizeText(body.participantId, "", 80);
    const room = rooms.get(roomId);
    const participant = room && room.participants[participantId];

    if (!room || !participant) {
      sendJson(req, res, 404, { error: "Room or participant not found" });
      return true;
    }

    updateParticipantPresence(participant, body);
    updateRoundProgress(room, participant, body);
    refreshRoomLifecycle(room);

    sendJson(req, res, 200, { ok: true, room: roomSummary(room, participantId) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/host/start-round") {
    const body = await readJson(req);
    const roomId = sanitizeText(body.roomId, "", 32);
    const participantId = sanitizeText(body.participantId, "", 80);
    const room = rooms.get(roomId);

    if (!room) {
      sendJson(req, res, 404, { error: "Room not found" });
      return true;
    }

    try {
      startRound(room, participantId);
      sendJson(req, res, 200, { ok: true, room: roomSummary(room, participantId) });
    } catch (error) {
      sendJson(req, res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/host/select-game") {
    const body = await readJson(req);
    const roomId = sanitizeText(body.roomId, "", 32);
    const participantId = sanitizeText(body.participantId, "", 80);
    const room = rooms.get(roomId);
    const gameId = sanitizeText(body.gameId, "", 32);

    if (!room) {
      sendJson(req, res, 404, { error: "Room not found" });
      return true;
    }

    try {
      setRoomGame(room, participantId, gameId);
      sendJson(req, res, 200, { ok: true, room: roomSummary(room, participantId) });
    } catch (error) {
      sendJson(req, res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/host/reset-leaderboard") {
    const body = await readJson(req);
    const roomId = sanitizeText(body.roomId, "", 32);
    const participantId = sanitizeText(body.participantId, "", 80);
    const room = rooms.get(roomId);

    if (!room) {
      sendJson(req, res, 404, { error: "Room not found" });
      return true;
    }

    try {
      resetLeaderboard(room, participantId);
      sendJson(req, res, 200, { ok: true, room: roomSummary(room, participantId) });
    } catch (error) {
      sendJson(req, res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/rooms/state") {
    const roomId = sanitizeText(searchParams.get("roomId"), "", 32);
    const participantId = sanitizeText(searchParams.get("participantId"), "", 80);
    const room = rooms.get(roomId);

    if (!room) {
      sendJson(req, res, 404, { error: "Room not found" });
      return true;
    }

    sendJson(req, res, 200, { ok: true, room: roomSummary(room, participantId) });
    return true;
  }

  return false;
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(req, res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(req, res, 404, { error: "Not found" });
        return;
      }

      sendJson(req, res, 500, { error: "Failed to read file" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const handled = await handleApi(req, res, requestUrl.pathname, requestUrl.searchParams);

    if (!handled) {
      serveStatic(req, res, requestUrl.pathname);
    }
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error(`[${requestId}]`, error);
    sendJson(req, res, 500, {
      error: "Internal server error",
      requestId,
      detail: error.message,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
