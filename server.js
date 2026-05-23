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
  const json = JSON.stringify(payload);
  setCorsHeaders(req, res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(json);
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

function makePlayerState({ playerId, nickname }) {
  return {
    id: playerId,
    nickname: nickname || "Player",
    hp: 100,
    modelUrl: "",
    modelName: "",
    labels: [],
    selectedLabel: "",
    currentLabel: "",
    currentConfidence: 0,
    attackCount: 0,
    lastAttackAt: 0,
    joinedAt: now(),
    lastSeenAt: now(),
  };
}

function makeRoom(roomId) {
  return {
    id: roomId,
    createdAt: now(),
    phase: "waiting",
    winnerId: null,
    players: {},
    playerOrder: [],
    lastEventId: 0,
    events: [],
  };
}

function roomSummary(room, requesterId) {
  const players = room.playerOrder
    .map((playerId) => room.players[playerId])
    .filter(Boolean)
    .map((player) => ({
      id: player.id,
      nickname: player.nickname,
      hp: player.hp,
      modelName: player.modelName,
      selectedLabel: player.selectedLabel,
      currentLabel: player.currentLabel,
      currentConfidence: player.currentConfidence,
      attackCount: player.attackCount,
      isRequester: player.id === requesterId,
      lastSeenAt: player.lastSeenAt,
    }));

  return {
    id: room.id,
    phase: room.phase,
    winnerId: room.winnerId,
    playerCount: players.length,
    me: players.find((player) => player.id === requesterId) || null,
    opponent: players.find((player) => player.id !== requesterId) || null,
    players,
    events: room.events.slice(-8),
    serverTime: now(),
  };
}

function addEvent(room, message, type = "info") {
  room.lastEventId += 1;
  room.events.push({
    id: room.lastEventId,
    type,
    message,
    createdAt: now(),
  });

  if (room.events.length > 40) {
    room.events.shift();
  }
}

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, makeRoom(roomId));
  }
  return rooms.get(roomId);
}

function cleanupRooms() {
  const staleThreshold = now() - 180_000;

  for (const [roomId, room] of rooms.entries()) {
    room.playerOrder = room.playerOrder.filter((playerId) => {
      const player = room.players[playerId];
      if (!player) {
        return false;
      }

      if (player.lastSeenAt < staleThreshold) {
        delete room.players[playerId];
        addEvent(room, `${player.nickname} 離線，已移出房間`, "leave");
        return false;
      }

      return true;
    });

    if (room.playerOrder.length === 0) {
      rooms.delete(roomId);
    }
  }
}

function startMatchIfReady(room) {
  if (room.playerOrder.length !== 2) {
    room.phase = "waiting";
    room.winnerId = null;
    return;
  }

  const players = room.playerOrder.map((id) => room.players[id]).filter(Boolean);
  const allReady = players.every((player) => player.selectedLabel && player.modelUrl);

  if (allReady && room.phase === "waiting") {
    room.phase = "active";
    room.winnerId = null;
    players.forEach((player) => {
      player.hp = 100;
      player.attackCount = 0;
      player.lastAttackAt = 0;
    });
    addEvent(room, "雙方已就緒，對戰開始", "start");
  }
}

function handleAttack(room, attackerId) {
  if (room.phase !== "active") {
    return;
  }

  const attacker = room.players[attackerId];
  if (!attacker) {
    return;
  }

  const opponentId = room.playerOrder.find((playerId) => playerId !== attackerId);
  const opponent = opponentId ? room.players[opponentId] : null;
  if (!opponent) {
    return;
  }

  if (now() - attacker.lastAttackAt < 1200) {
    return;
  }

  attacker.lastAttackAt = now();
  attacker.attackCount += 1;
  opponent.hp = Math.max(0, opponent.hp - 10);
  addEvent(room, `${attacker.nickname} 成功使出 ${attacker.selectedLabel}，造成 10 點傷害`, "attack");

  if (opponent.hp <= 0) {
    room.phase = "finished";
    room.winnerId = attacker.id;
    addEvent(room, `${attacker.nickname} 獲勝`, "finish");
  }
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
    const roomId = String(body.roomId || "").trim();
    const playerId = String(body.playerId || "").trim();
    const nickname = String(body.nickname || "").trim();

    if (!roomId || !playerId) {
      sendJson(req, res, 400, { error: "roomId and playerId are required" });
      return true;
    }

    const room = ensureRoom(roomId);
    const existing = room.players[playerId];

    if (!existing && room.playerOrder.length >= 2) {
      sendJson(req, res, 409, { error: "This room already has 2 players" });
      return true;
    }

    if (!existing) {
      room.players[playerId] = makePlayerState({ playerId, nickname });
      room.playerOrder.push(playerId);
      addEvent(room, `${nickname || "Player"} 進入房間`, "join");
    } else {
      existing.nickname = nickname || existing.nickname;
      existing.lastSeenAt = now();
    }

    startMatchIfReady(room);
    sendJson(req, res, 200, { ok: true, room: roomSummary(room, playerId) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/update") {
    const body = await readJson(req);
    const roomId = String(body.roomId || "").trim();
    const playerId = String(body.playerId || "").trim();

    if (!roomId || !playerId) {
      sendJson(req, res, 400, { error: "roomId and playerId are required" });
      return true;
    }

    const room = rooms.get(roomId);
    const player = room && room.players[playerId];
    if (!room || !player) {
      sendJson(req, res, 404, { error: "Room or player not found" });
      return true;
    }

    player.nickname = String(body.nickname || player.nickname).trim() || player.nickname;
    player.modelUrl = String(body.modelUrl || player.modelUrl).trim();
    player.modelName = String(body.modelName || player.modelName).trim();
    player.labels = Array.isArray(body.labels) ? body.labels.map(String) : player.labels;
    player.selectedLabel = String(body.selectedLabel || player.selectedLabel).trim();
    player.currentLabel = String(body.currentLabel || "").trim();
    player.currentConfidence = Number(body.currentConfidence || 0);
    player.lastSeenAt = now();

    startMatchIfReady(room);

    if (body.resetBattle) {
      room.phase = "waiting";
      room.winnerId = null;
      room.playerOrder.forEach((id) => {
        const member = room.players[id];
        if (member) {
          member.hp = 100;
          member.attackCount = 0;
          member.lastAttackAt = 0;
        }
      });
      addEvent(room, `${player.nickname} 已重置對戰`, "reset");
      startMatchIfReady(room);
    }

    if (body.attackPulse === true) {
      handleAttack(room, playerId);
    }

    sendJson(req, res, 200, { ok: true, room: roomSummary(room, playerId) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/rooms/state") {
    const roomId = String(searchParams.get("roomId") || "").trim();
    const playerId = String(searchParams.get("playerId") || "").trim();
    const room = rooms.get(roomId);

    if (!room) {
      sendJson(req, res, 404, { error: "Room not found" });
      return true;
    }

    sendJson(req, res, 200, { ok: true, room: roomSummary(room, playerId) });
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
