import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT || 2567);
const HOST_KEY = String(process.env.TITAN_HOST_KEY || '');
const rooms = new Map();
const sockets = new Map();
const MAX_PER_TEAM = 15;
const PLAYER_RECONNECT_MS = 60_000;
const EMPTY_ROOM_TTL_MS = 30 * 60_000;
const DESTINATION_PROGRESS = 100;

const httpServer = createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'GET' && (path === '/' || path === '/health' || path === '/healthz')) {
    const body = JSON.stringify({ service: 'TITAN multiplayer', status: 'online', protocol: 'titan-room-v2', rooms: rooms.size });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024, perMessageDeflate: false });

function cleanText(value, max = 32) {
  return String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
}
function makeCode() {
  let value;
  do { value = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(value));
  return value;
}
function makeId() { return randomBytes(12).toString('hex'); }
function isHostKeyValid(candidate) {
  if (!HOST_KEY || HOST_KEY === 'CHANGE_THIS_HOST_KEY') return false;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(HOST_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}
function safeCharacter(input, fallbackName) {
  const c = input && typeof input === 'object' ? input : {};
  const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : fallback;
  const clamp = (v, lo, hi, fallback) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback;
  return {
    name: cleanText(c.name || fallbackName || 'Crew Member', 24),
    skinColor: color(c.skinColor, '#d9a47f'),
    outfitColor: color(c.outfitColor, '#2b8990'),
    accentColor: color(c.accentColor, '#e2bd78'),
    hairColor: color(c.hairColor, '#28333b'),
    hairStyle: ['short', 'long', 'curly', 'none'].includes(c.hairStyle) ? c.hairStyle : 'short',
    accessory: ['none', 'glasses', 'cap'].includes(c.accessory) ? c.accessory : 'none',
    height: clamp(c.height, .88, 1.12, 1),
    bodyBuild: clamp(c.bodyBuild, .84, 1.18, 1),
    animationSpeed: clamp(c.animationSpeed, .65, 1.5, 1)
  };
}
function getSnapshot(room) {
  return {
    code: room.code,
    status: room.status,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    settings: room.settings,
    ships: room.ships,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, ready: !!p.ready,
      connected: !!p.ws, x: p.x, z: p.z, yaw: p.yaw, movingUntil: p.movingUntil || 0,
      character: p.character
    })),
    winner: room.winner,
    countdownEndsAt: room.countdownEndsAt
  };
}
function send(ws, type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}
function error(ws, message, code = 'REQUEST_FAILED') {
  send(ws, 'error', { message, code });
}
function broadcast(room) {
  room.lastActivity = Date.now();
  const message = JSON.stringify({ type: 'state', state: getSnapshot(room) });
  for (const client of room.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
  room.dirty = false;
}
function attachToRoom(room, ws, role) {
  const session = sockets.get(ws);
  if (session?.roomCode) {
    const oldRoom = rooms.get(session.roomCode);
    if (oldRoom) oldRoom.clients.delete(ws);
  }
  room.clients.add(ws);
  session.roomCode = room.code;
  session.role = role;
}
function createRoom(ws) {
  const code = makeCode();
  const now = Date.now();
  const room = {
    code,
    status: 'lobby',
    createdAt: now,
    lastActivity: now,
    startedAt: null,
    countdownEndsAt: null,
    countdownTimer: null,
    winner: null,
    hostWs: ws,
    clients: new Set(),
    players: new Map(),
    dirty: true,
    settings: { maxPerTeam: MAX_PER_TEAM, destination: 'VIRTUAL FINISH GATE', map: 'TITAN CUSTOM COURSE' },
    ships: {
      A: { x: -7, z: 0, yaw: 0, speed: 0, progress: 0, hp: 100 },
      B: { x: 7, z: 0, yaw: 0, speed: 0, progress: 0, hp: 100 }
    }
  };
  rooms.set(code, room);
  attachToRoom(room, ws, 'host');
  send(ws, 'created', { code, state: getSnapshot(room) });
  broadcast(room);
}
function teamCount(room, team, excludeId = null) {
  let n = 0;
  for (const p of room.players.values()) if (p.team === team && p.id !== excludeId) n++;
  return n;
}
function addPlayer(room, ws, msg) {
  const deviceId = cleanText(msg.deviceId, 80) || makeId();
  const team = msg.team === 'B' ? 'B' : msg.team === 'A' ? 'A' : '';
  if (!team) return error(ws, 'Choose Ship A or Ship B before joining.', 'TEAM_REQUIRED');
  const name = cleanText(msg.name, 22) || 'Crew Member';
  const existing = room.players.get(deviceId);
  if (existing?.ws && existing.ws.readyState === WebSocket.OPEN && existing.ws !== ws) {
    return error(ws, 'This player is already connected from another tab or device.', 'PLAYER_ALREADY_CONNECTED');
  }
  if (room.status !== 'lobby' && !existing) return error(ws, 'This race has already started. New players cannot join now.', 'RACE_ALREADY_STARTED');
  if (teamCount(room, team, existing?.id || null) >= MAX_PER_TEAM) {
    return error(ws, `Ship ${team} is full. Each ship can have a maximum of 15 players.`, 'TEAM_FULL');
  }
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer);
  let player = existing;
  if (!player) {
    const n = teamCount(room, team);
    player = {
      id: deviceId, name, team, ready: false, connected: true,
      x: ((n % 5) - 2) * 1.05,
      z: (Math.floor(n / 5) - 1) * 1.35,
      yaw: 0, character: safeCharacter(msg.character, name), ws: null,
      reconnectTimer: null, lastMoveAt: 0
    };
    room.players.set(deviceId, player);
  } else {
    player.name = name;
    player.team = team;
    player.character = safeCharacter(msg.character || player.character, name);
  }
  player.ws = ws;
  player.connected = true;
  player.reconnectTimer = null;
  attachToRoom(room, ws, 'player');
  sockets.get(ws).playerId = deviceId;
  room.dirty = true;
  send(ws, 'joined', { playerId: deviceId, team, state: getSnapshot(room) });
  broadcast(room);
}
function removeDisconnectedPlayer(room, player) {
  if (!room || !player || player.ws || player.connected) return;
  room.players.delete(player.id);
  room.dirty = true;
  broadcast(room);
}
function resetRoom(room) {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = null;
  room.status = 'lobby';
  room.winner = null;
  room.startedAt = null;
  room.countdownEndsAt = null;
  for (const p of room.players.values()) p.ready = false;
  room.ships.A = { x: -7, z: 0, yaw: 0, speed: 0, progress: 0, hp: 100 };
  room.ships.B = { x: 7, z: 0, yaw: 0, speed: 0, progress: 0, hp: 100 };
  room.dirty = true;
  broadcast(room);
}

wss.on('connection', ws => {
  const session = { role: null, roomCode: null, playerId: null };
  sockets.set(ws, session);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return error(ws, 'Invalid message format.', 'BAD_JSON'); }
    if (!msg || typeof msg.type !== 'string') return error(ws, 'Message type is required.', 'BAD_MESSAGE');

    if (msg.type === 'host:create') {
      if (session.role) return error(ws, 'This connection is already assigned to a session.', 'SESSION_EXISTS');
      if (!isHostKeyValid(msg.hostKey)) return error(ws, 'Host key is incorrect or TITAN_HOST_KEY is not configured on Render.', 'HOST_AUTH_FAILED');
      return createRoom(ws);
    }

    if (msg.type === 'host:claim') {
      if (!isHostKeyValid(msg.hostKey)) return error(ws, 'Host key is incorrect.', 'HOST_AUTH_FAILED');
      const code = cleanText(msg.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return error(ws, 'Room not found. Check the room code.', 'ROOM_NOT_FOUND');
      if (room.hostWs && room.hostWs !== ws && room.hostWs.readyState === WebSocket.OPEN) {
        return error(ws, 'This room already has an active host device. Close the other host session first.', 'HOST_ALREADY_CONNECTED');
      }
      room.hostWs = ws;
      attachToRoom(room, ws, 'host');
      send(ws, 'host:claimed', { code: room.code, state: getSnapshot(room) });
      broadcast(room);
      return;
    }

    if (msg.type === 'room:check') {
      const code = cleanText(msg.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return error(ws, 'Room not found. Check the code with the host.', 'ROOM_NOT_FOUND');
      const teamA = teamCount(room, 'A'), teamB = teamCount(room, 'B');
      send(ws, 'room:checked', {
        state: getSnapshot(room),
        seats: { A: Math.max(0, MAX_PER_TEAM - teamA), B: Math.max(0, MAX_PER_TEAM - teamB) },
        canJoin: room.status === 'lobby'
      });
      return;
    }

    if (msg.type === 'join') {
      if (session.role && session.role !== 'player') return error(ws, 'This connection is already in use.', 'SESSION_EXISTS');
      const code = cleanText(msg.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return error(ws, 'Room not found. Ask the host for the current room code.', 'ROOM_NOT_FOUND');
      return addPlayer(room, ws, msg);
    }

    if (msg.type === 'watch') {
      const code = cleanText(msg.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return error(ws, 'Room not found. Ask the host for the current room code.', 'ROOM_NOT_FOUND');
      attachToRoom(room, ws, 'spectator');
      send(ws, 'watching', { code: room.code, state: getSnapshot(room) });
      broadcast(room);
      return;
    }

    const room = rooms.get(session.roomCode || '');
    if (!room) return error(ws, 'Join or create a room before sending this command.', 'NOT_IN_ROOM');

    if (msg.type === 'player:leave' && session.role === 'player') {
      const player = room.players.get(session.playerId);
      if (player) {
        if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
        room.players.delete(session.playerId);
        room.dirty = true;
        broadcast(room);
      }
      room.clients.delete(ws);
      session.role = null;
      session.roomCode = null;
      session.playerId = null;
      send(ws, 'left', {});
      return;
    }

    if (msg.type === 'player:ready' && session.role === 'player') {
      const player = room.players.get(session.playerId);
      if (!player) return error(ws, 'Player session has expired. Rejoin the room.', 'PLAYER_NOT_FOUND');
      if (room.status !== 'lobby') return error(ws, 'Readiness can only change in the lobby.', 'RACE_NOT_IN_LOBBY');
      player.ready = !!msg.ready;
      room.dirty = true;
      broadcast(room);
      return;
    }

    if (msg.type === 'player:move' && session.role === 'player') {
      const player = room.players.get(session.playerId);
      if (!player) return error(ws, 'Player session has expired. Rejoin the room.', 'PLAYER_NOT_FOUND');
      const now = Date.now();
      if (now - player.lastMoveAt < 45) return;
      player.lastMoveAt = now;
      player.x = Math.max(-3.1, Math.min(3.1, Number(msg.x) || 0));
      player.z = Math.max(-5.5, Math.min(5.5, Number(msg.z) || 0));
      player.yaw = Math.max(-Math.PI, Math.min(Math.PI, Number(msg.yaw) || 0));
      player.movingUntil = now + 350;
      room.dirty = true;
      return;
    }

    if (msg.type === 'host:start' && session.role === 'host') {
      if (room.status !== 'lobby') return error(ws, 'The race is not in the lobby.', 'RACE_NOT_IN_LOBBY');
      if (room.players.size < 2 || !teamCount(room, 'A') || !teamCount(room, 'B')) {
        return error(ws, 'At least one player must be on each ship before starting.', 'BOTH_TEAMS_REQUIRED');
      }
      const notReady = [...room.players.values()].filter(p => !p.ready || !p.ws || p.ws.readyState !== WebSocket.OPEN);
      if (notReady.length) return error(ws, `${notReady.length} player(s) are not connected and READY.`, 'PLAYERS_NOT_READY');
      room.status = 'countdown';
      room.countdownEndsAt = Date.now() + 5000;
      room.dirty = true;
      broadcast(room);
      room.countdownTimer = setTimeout(() => {
        if (rooms.get(room.code) !== room || room.status !== 'countdown') return;
        room.status = 'racing';
        room.startedAt = Date.now();
        room.countdownEndsAt = null;
        room.dirty = true;
        broadcast(room);
      }, 5000);
      return;
    }

    if (msg.type === 'host:ship' && session.role === 'host') {
      const team = msg.team === 'B' ? 'B' : 'A';
      const ship = room.ships[team];
      if (Number.isFinite(Number(msg.speed))) ship.speed = Math.max(0, Math.min(100, Number(msg.speed)));
      if (Number.isFinite(Number(msg.yaw))) ship.yaw = Math.max(-Math.PI, Math.min(Math.PI, Number(msg.yaw)));
      if (Number.isFinite(Number(msg.x))) ship.x = Math.max(-50, Math.min(50, Number(msg.x)));
      if (Number.isFinite(Number(msg.z))) ship.z = Math.max(-1000, Math.min(1000, Number(msg.z)));
      room.dirty = true;
      broadcast(room);
      return;
    }

    if (msg.type === 'host:finish' && session.role === 'host') {
      if (room.status !== 'racing') return error(ws, 'The race has not started.', 'RACE_NOT_RUNNING');
      room.status = 'finished';
      room.winner = msg.team === 'B' ? 'B' : 'A';
      room.dirty = true;
      broadcast(room);
      return;
    }

    if (msg.type === 'host:reset' && session.role === 'host') {
      resetRoom(room);
      return;
    }

    if (msg.type === 'host:kick' && session.role === 'host') {
      const id = cleanText(msg.playerId, 80);
      const player = room.players.get(id);
      if (!player) return error(ws, 'Player not found.', 'PLAYER_NOT_FOUND');
      if (player.ws) {
        send(player.ws, 'kicked', { message: 'The host removed you from this room.' });
        player.ws.close(4003, 'Removed by host');
      }
      if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
      room.players.delete(id);
      room.dirty = true;
      broadcast(room);
      return;
    }

    error(ws, 'This action is not allowed for your session.', 'NOT_AUTHORIZED');
  });

  ws.on('close', () => {
    const current = sockets.get(ws);
    if (!current) return;
    const room = rooms.get(current.roomCode || '');
    if (room) {
      room.clients.delete(ws);
      if (current.role === 'host' && room.hostWs === ws) room.hostWs = null;
      if (current.role === 'player') {
        const player = room.players.get(current.playerId);
        if (player && player.ws === ws) {
          player.ws = null;
          player.connected = false;
          player.reconnectTimer = setTimeout(() => removeDisconnectedPlayer(room, player), PLAYER_RECONNECT_MS);
          room.dirty = true;
          broadcast(room);
        }
      }
      room.lastActivity = Date.now();
    }
    sockets.delete(ws);
  });

  ws.on('error', () => {});
});

// Broadcast changed lobby/position state at a controlled rate; race progress is authoritative here.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === 'racing') {
      for (const team of ['A', 'B']) {
        const ship = room.ships[team];
        if (ship.speed > 0) ship.progress = Math.min(DESTINATION_PROGRESS, ship.progress + ship.speed * 0.004);
      }
      if (room.ships.A.progress >= DESTINATION_PROGRESS || room.ships.B.progress >= DESTINATION_PROGRESS) {
        room.status = 'finished';
        room.winner = room.ships.A.progress >= room.ships.B.progress ? 'A' : 'B';
      }
      room.dirty = true;
    }
    if (room.dirty) broadcast(room);
    if (room.clients.size === 0 && now - room.lastActivity > EMPTY_ROOM_TTL_MS) {
      if (room.countdownTimer) clearTimeout(room.countdownTimer);
      for (const player of room.players.values()) if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
      rooms.delete(room.code);
    }
  }
}, 100);

// Basic WebSocket heartbeat detects dead mobile connections and frees stale sockets.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`TITAN multiplayer v2 listening on port ${PORT}`);
});
