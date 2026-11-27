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
const MAP_BOUNDS = { minX: -38, maxX: 38, minZ: -27, maxZ: 27 };
const SHIP_MIN_SEPARATION = 8.5;
const DECK_BOUNDS = { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.10 };
const AREA_BOUNDS = {
  'main-deck': DECK_BOUNDS,
  'engine-room': { minX: -13.2, maxX: 13.2, minZ: -6.6, maxZ: 6.6 },
  storage: { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.10 }
};

// Mirrors main-deck.html's ship-local staticHitboxes. Coordinates are in its
// local deck frame, so both ship instances use the same obstacle geometry but
// never share player transforms or system state.
function buildDeckColliders() {
  const boxes = [];
  const add = (minX, maxX, minZ, maxZ) => boxes.push({ minX, maxX, minZ, maxZ });
  for (const z of [-2, 6, 13]) add(-2.62, 2.62, z - 1.64, z + 1.64);
  for (const side of [-1, 1]) {
    for (const [x, z] of [[side * 2.25, 17.8], [side * 3.45, -15.8]]) add(x - .30, x + .30, z - .30, z + .30);
    const wx = side * 2.45; add(wx - .45, wx + .45, 16.3 - .38, 16.3 + .38);
    const fx = side * 3.10; add(fx - .10, fx + .10, -13.2 - .28, -13.2 + .28);
    const hx = side * 2.1; add(hx - .48, hx + .48, -18.6 - .48, -18.6 + .48);
  }
  add(-1.24, 1.24, 18.26, 20.52);                         // anchor windlass
  add(-.22, .22, 22.90, 23.40);                          // bow jackstaff
  add(-2.15 - .45, -2.15 + .45, 2.0 - .45, 2.0 + .45); // deck crane base
  for (const [x, z] of [[-2.20, 9.65], [2.20, 9.65], [-2.15, -6.15], [2.15, -6.15]]) add(x - .26, x + .26, z - .26, z + .26);
  add(-.40, .40, -19.20, -18.40);                       // aft capstan
  add(-.25, .25, -20.75, -20.25);                      // stern flagstaff
  add(-3.08, -2.86, -17.46, -6.82);                     // bridge/superstructure walls
  add(2.86, 3.08, -17.46, -10.20);
  add(2.86, 3.08, -8.10, -6.82);
  add(-3.08, 3.08, -17.46, -16.27);
  add(-3.08, 3.08, -7.05, -6.78);
  add(-1.22, 1.22, -7.73 - .82, -7.73 + .82);          // chart table
  add(-2.90, -1.94, -10.78, -8.42);                     // port radar console
  add(-2.90, -1.94, -14.28, -11.92);                    // port sonar console
  add(1.98, 2.90, -14.38, -11.92);                      // comms rack
  add(-2.74, .04, -16.30, -15.42);                      // aft switchboard
  add(-2.36, -1.54, -7.12, -6.85);
  add(1.54, 2.36, -7.12, -6.85);
  add(2.60, 2.90, -11.15, -10.55);                      // fire locker
  return boxes;
}
const DECK_COLLIDERS = buildDeckColliders();
const PLAYER_RADIUS = .30;

function resolveCircleVsAabb(pos, box) {
  const cx = clampNumber(pos.x, box.minX, box.maxX, pos.x);
  const cz = clampNumber(pos.z, box.minZ, box.maxZ, pos.z);
  const dx = pos.x - cx, dz = pos.z - cz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= PLAYER_RADIUS * PLAYER_RADIUS) return;
  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq), push = PLAYER_RADIUS - dist;
    pos.x += dx / dist * push; pos.z += dz / dist * push;
  } else {
    const dLeft = Math.abs(pos.x - (box.minX - PLAYER_RADIUS));
    const dRight = Math.abs((box.maxX + PLAYER_RADIUS) - pos.x);
    const dBack = Math.abs(pos.z - (box.minZ - PLAYER_RADIUS));
    const dFront = Math.abs((box.maxZ + PLAYER_RADIUS) - pos.z);
    const min = Math.min(dLeft, dRight, dBack, dFront);
    if (min === dLeft) pos.x = box.minX - PLAYER_RADIUS;
    else if (min === dRight) pos.x = box.maxX + PLAYER_RADIUS;
    else if (min === dBack) pos.z = box.minZ - PLAYER_RADIUS;
    else pos.z = box.maxZ + PLAYER_RADIUS;
  }
}

function constrainMainDeckPosition(pos) {
  pos.z = clampNumber(pos.z, DECK_BOUNDS.minZ, DECK_BOUNDS.maxZ, 0);
  if (pos.z > 15.5) {
    const t = clampNumber((pos.z - 15.5) / 7.5, 0, 1, 0);
    const halfWidth = 3.90 * (1 - t) + 1.45 * t;
    pos.x = clampNumber(pos.x, -halfWidth, halfWidth, 0);
  } else {
    pos.x = clampNumber(pos.x, -3.90, 3.90, 0);
  }
}

function resolveMainDeckCollisions(room, player) {
  const ship = room.ships[player.team];
  const pos = { x: player.x, z: player.z };
  constrainMainDeckPosition(pos);
  const colliders = DECK_COLLIDERS.slice();
  if (ship && !ship.systems.doorOpen) {
    // Two closed sliding leaves at DOOR_X=2.95, DOOR_Z=-9.15.
    colliders.push({ minX: 2.83, maxX: 3.07, minZ: -9.15, maxZ: -8.23 });
    colliders.push({ minX: 2.83, maxX: 3.07, minZ: -10.07, maxZ: -9.15 });
  }
  if (ship && ship.systems.hatchOpen) {
    // Open deck hatch: retain a collision rim around the ladder opening.
    const x = 1.45, z = -15.25;
    colliders.push({ minX: x - .56, maxX: x - .34, minZ: z - .56, maxZ: z + .56 });
    colliders.push({ minX: x + .34, maxX: x + .56, minZ: z - .56, maxZ: z + .56 });
    colliders.push({ minX: x - .56, maxX: x + .56, minZ: z - .56, maxZ: z - .34 });
    colliders.push({ minX: x - .56, maxX: x + .56, minZ: z + .34, maxZ: z + .56 });
  }
  for (let iter = 0; iter < 3; iter++) {
    for (const box of colliders) resolveCircleVsAabb(pos, box);
    constrainMainDeckPosition(pos);
  }
  player.x = pos.x; player.z = pos.z;
}

const httpServer = createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'GET' && (path === '/' || path === '/health' || path === '/healthz')) {
    const body = JSON.stringify({ service: 'TITAN multiplayer', status: 'online', protocol: 'titan-world-v3', rooms: rooms.size });
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
  const players = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, team: p.team, ready: !!p.ready,
    connected: p.isHost ? !!room.hostWs && room.hostWs.readyState === WebSocket.OPEN : !!p.ws && p.ws.readyState === WebSocket.OPEN,
    isHost: !!p.isHost, x: p.x, z: p.z, yaw: p.yaw,
    movingUntil: p.movingUntil || 0, character: p.character,
    area: p.area || 'main-deck'
  }));
  return {
    protocol: 'titan-world-v3', code: room.code, status: room.status,
    createdAt: room.createdAt, startedAt: room.startedAt,
    settings: room.settings, map: room.map, ships: room.ships, players,
    hostPlayerId: room.hostPlayerId, winner: room.winner,
    countdownEndsAt: room.countdownEndsAt
  };
}
function makeShip(team) {
  return {
    id: 'ship-' + team, team,
    // Safe provisional positions are replaced from projection.html's live geometry
    // as soon as the host map iframe reports its actual route and obstacle records.
    x: -32, z: team === 'A' ? 18 : -18,
    yaw: 0,
    speed: 0, throttle: 0, rudder: 0, progress: 0, hp: 100, grounded: false,
    collision: { halfLength: 2.45, halfWidth: 0.55, minDeckX: DECK_BOUNDS.minX, maxDeckX: DECK_BOUNDS.maxX, minDeckZ: DECK_BOUNDS.minZ, maxDeckZ: DECK_BOUNDS.maxZ },
    systems: {
      engine: { running: false, throttle: 0, rudder: 0, condition: 100 },
      power: { online: true, load: 0 },
      cooling: { online: true, temperature: 42 },
      reactor: { online: true, output: 0 },
      doorOpen: false, hatchOpen: false, lastInteraction: null, revision: 0
    }
  };
}
function createHostActor(room) {
  const id = 'host-' + room.code;
  room.hostPlayerId = id;
  room.players.set(id, {
    id, isHost: true, name: 'Captain', team: 'A', ready: true, connected: true,
    x: 0.85, z: -14.35, yaw: 0, area: 'main-deck',
    character: safeCharacter({ name: 'Captain', outfitColor: '#237f93', accentColor: '#e2bd78' }, 'Captain'),
    ws: null, reconnectTimer: null, lastMoveAt: 0
  });
}
function crewPlayers(room) { return [...room.players.values()].filter(p => !p.isHost); }
function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function shipCenterBounds(room, ship) {
  const b = room.map?.bounds || MAP_BOUNDS;
  return {
    minX: Number(b.minX) + ship.collision.halfLength,
    maxX: Number(b.maxX) - ship.collision.halfLength,
    minZ: Number(b.minZ) + ship.collision.halfWidth,
    maxZ: Number(b.maxZ) - ship.collision.halfWidth
  };
}
function shipPoseClearOfMap(room, ship, x, z, yaw) {
  const mapBounds = room.map?.bounds || MAP_BOUNDS;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const extentX = Math.abs(c) * ship.collision.halfLength + Math.abs(sn) * ship.collision.halfWidth;
  const extentZ = Math.abs(sn) * ship.collision.halfLength + Math.abs(c) * ship.collision.halfWidth;
  if (x - extentX < mapBounds.minX || x + extentX > mapBounds.maxX || z - extentZ < mapBounds.minZ || z + extentZ > mapBounds.maxZ) return false;
  const obstacles = room.map?.obstacles || [];
  const halfLength = ship.collision.halfLength, halfWidth = ship.collision.halfWidth;
  for (const obstacle of obstacles) {
    const dx = obstacle.x - x, dz = obstacle.z - z;
    // Project obstacle centre into the vessel's local hull axes, then measure
    // distance to the oriented rectangle rather than using a visual-only circle.
    const localX = dx * c + dz * sn;
    const localZ = -dx * sn + dz * c;
    const outsideX = Math.max(0, Math.abs(localX) - halfLength);
    const outsideZ = Math.max(0, Math.abs(localZ) - halfWidth);
    if (Math.hypot(outsideX, outsideZ) < obstacle.shallowDangerR) return false;
  }
  return true;
}
function mapSpawnPair(room, route) {
  const start = Array.isArray(route?.[0]) ? route[0] : [-32, 18];
  const bounds = room.map?.bounds || MAP_BOUNDS;
  const sx = clampNumber(start[0], bounds.minX + 3, bounds.maxX - 3, -32);
  const sz = clampNumber(start[1], bounds.minZ + 1, bounds.maxZ - 1, 18);
  const aShip = room.ships.A, bShip = room.ships.B;
  const candidates = [];
  const centerA = shipCenterBounds(room, aShip);
  for (let ix = -3; ix <= 3; ix++) for (let iz = Math.ceil(centerA.minZ); iz <= Math.floor(centerA.maxZ); iz += 1) {
    const x = clampNumber(sx + ix * 2, centerA.minX, centerA.maxX, sx);
    const z = iz;
    if (shipPoseClearOfMap(room, aShip, x, z, 0)) candidates.push({ x, z, cost: Math.hypot(x - sx, z - sz) });
  }
  candidates.sort((a, b) => a.cost - b.cost);
  for (const a of candidates) {
    for (const b of candidates) {
      const distance = Math.hypot(b.x - a.x, b.z - a.z);
      if (distance < SHIP_MIN_SEPARATION + 2 || distance > 42) continue;
      if (!shipPoseClearOfMap(room, bShip, b.x, b.z, 0)) continue;
      // Prefer a pair that starts near the original projection route and is
      // comfortably separated, without choosing a new arbitrary map location.
      const separationPenalty = distance < 14 ? 30 : distance > 34 ? (distance - 34) * 0.8 : 0;
      const score = a.cost + b.cost + separationPenalty;
      return { A: a, B: b, score };
    }
  }
  return null;
}
function routeProgress(route, x, z) {
  if (!Array.isArray(route) || route.length < 2) return 0;
  const lengths = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const dx = route[i + 1][0] - route[i][0], dz = route[i + 1][1] - route[i][1];
    const length = Math.hypot(dx, dz);
    lengths.push({ dx, dz, length, start: total, ax: route[i][0], az: route[i][1] });
    total += length;
  }
  if (total <= 0) return 0;
  let bestDistance = Infinity, bestProgress = 0;
  for (const segment of lengths) {
    const t = segment.length > 0 ? clampNumber(((x - segment.ax) * segment.dx + (z - segment.az) * segment.dz) / (segment.length * segment.length), 0, 1, 0) : 0;
    const px = segment.ax + segment.dx * t, pz = segment.az + segment.dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgress = (segment.start + segment.length * t) / total;
    }
  }
  return clampNumber(bestProgress * 100, 0, 100, 0);
}

function acceptMapGeometry(room, raw) {
  if (!raw || typeof raw !== 'object' || raw.source !== 'map.html') return false;
  const sourceObstacles = Array.isArray(raw.obstacles) ? raw.obstacles.slice(0, 100) : [];
  const obstacles = [];
  for (const o of sourceObstacles) {
    if (!o || !['island', 'reef', 'rock', 'typhoon'].includes(o.type)) continue;
    const x = Number(o.x), z = Number(o.z), danger = Number(o.shallowDangerR);
    const solid = Number(o.solidR), warn = Number(o.shallowWarnR), scale = Number(o.scale);
    if (![x, z, danger, solid, warn, scale].every(Number.isFinite)) continue;
    if (Math.abs(x) > 41 || Math.abs(z) > 32 || scale <= 0 || scale > 8 || danger <= 0 || danger > 40) continue;
    obstacles.push({ type: o.type, x, z, scale, solidR: clampNumber(solid, 0, 40, 0), shallowDangerR: clampNumber(danger, 0.1, 40, 1), shallowWarnR: clampNumber(warn, 0.1, 50, danger) });
  }
  const route = Array.isArray(raw.route) ? raw.route.slice(0, 80).map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null).filter(p => p && p.every(Number.isFinite) && Math.abs(p[0]) <= 41 && Math.abs(p[1]) <= 32) : [];
  if (obstacles.length < 1 || route.length < 2) return false;
  const sourceBounds = raw.bounds && typeof raw.bounds === 'object' ? raw.bounds : {};
  const minX = Number(sourceBounds.minX), maxX = Number(sourceBounds.maxX);
  const minZ = Number(sourceBounds.minZ), maxZ = Number(sourceBounds.maxZ);
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ || (maxX - minX) > 300 || (maxZ - minZ) > 300) return false;
  room.map.bounds = { minX, maxX, minZ, maxZ };
  room.map.obstacles = obstacles;
  room.map.route = route;
  room.map.geometryReady = true;
  room.map.geometryRevision++;
  const pair = mapSpawnPair(room, route);
  if (!pair) { room.map.geometryReady = false; return false; }
  for (const team of ['A', 'B']) {
    const chosen = pair[team];
    const ship = room.ships[team];
    ship.x = chosen.x; ship.z = chosen.z; ship.yaw = 0;
    ship.progress = 0; ship.speed = 0; ship.grounded = false;
  }
  return true;
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
function createRoom(ws, message = {}) {
  const code = makeCode();
  const now = Date.now();
  const room = {
    code, status: 'lobby', createdAt: now, lastActivity: now,
    startedAt: null, countdownEndsAt: null, countdownTimer: null,
    winner: null, hostWs: ws, clients: new Set(), players: new Map(), dirty: true,
    settings: { maxPerTeam: MAX_PER_TEAM, destination: 'VIRTUAL FINISH GATE', map: 'MAP.HTML · LIVE TACTICAL WORLD' },
    map: { source: 'map.html', width: 82, depth: 64, bounds: MAP_BOUNDS, geometryReady: false, geometryRevision: 0, obstacles: [], route: [] },
    ships: { A: makeShip('A'), B: makeShip('B') }
  };
  createHostActor(room);
  const hostActor = room.players.get(room.hostPlayerId);
  if (hostActor && message.character) hostActor.character = safeCharacter(message.character, 'Captain');
  rooms.set(code, room);
  attachToRoom(room, ws, 'host');
  send(ws, 'created', { code, state: getSnapshot(room) });
  broadcast(room);
}

function teamCount(room, team, excludeId = null) {
  let n = 0;
  for (const p of room.players.values()) if (!p.isHost && p.team === team && p.id !== excludeId) n++;
  return n;
}
function addPlayer(room, ws, msg) {
  const deviceId = cleanText(msg.deviceId, 80) || makeId();
  const team = msg.team === 'B' ? 'B' : msg.team === 'A' ? 'A' : '';
  if (!team) return error(ws, 'Choose Ship A or Ship B before joining.', 'TEAM_REQUIRED');
  const name = cleanText(msg.name, 22) || 'Crew Member';
  const existing = room.players.get(deviceId);
  if (existing && existing.team !== team) {
    return error(ws, 'Your ship assignment is locked to Ship ' + existing.team + ' for this room.', 'TEAM_LOCKED');
  }
  if (existing?.ws && existing.ws.readyState === WebSocket.OPEN && existing.ws !== ws) {
    return error(ws, 'This player is already connected from another tab or device.', 'PLAYER_ALREADY_CONNECTED');
  }
  if (room.status === 'finished' && !existing) return error(ws, 'This match has finished. Ask the host to reset the room before joining.', 'RACE_FINISHED');
  if (teamCount(room, team, existing?.id || null) >= MAX_PER_TEAM) {
    return error(ws, `Ship ${team} is full. Each ship can have a maximum of 15 players.`, 'TEAM_FULL');
  }
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer);
  let player = existing;
  if (!player) {
    const n = teamCount(room, team);
    const spawnColumns = [-1.30, -0.65, 0, 0.65, 1.30];
    const spawnRows = [-14.95, -13.60, -12.25];
    player = {
      id: deviceId, isHost: false, name, team, ready: room.status !== 'lobby', connected: true,
      x: spawnColumns[n % spawnColumns.length],
      z: spawnRows[Math.floor(n / spawnColumns.length)] || -10.90,
      yaw: 0, area: 'main-deck', character: safeCharacter(msg.character, name), ws: null,
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
  room.status = 'lobby'; room.winner = null;
  room.startedAt = null; room.countdownEndsAt = null;
  for (const p of room.players.values()) {
    p.ready = !!p.isHost;
    if (p.isHost) { p.x = 0.85; p.z = -14.35; p.yaw = 0; }
  }
  room.ships.A = makeShip('A'); room.ships.B = makeShip('B');
  if (room.map.geometryReady) {
    const pair = mapSpawnPair(room, room.map.route);
    if (pair) for (const t of ['A', 'B']) { room.ships[t].x = pair[t].x; room.ships[t].z = pair[t].z; }
  }
  room.dirty = true; broadcast(room);
}
function setPlayerPose(room, player, msg) {
  const now = Date.now();
  if (now - (player.lastMoveAt || 0) < 35) return;
  player.lastMoveAt = now;
  player.area = ['main-deck', 'engine-room', 'storage'].includes(msg.area) ? msg.area : (player.area || 'main-deck');
  const bounds = AREA_BOUNDS[player.area] || DECK_BOUNDS;
  player.x = clampNumber(msg.x, bounds.minX, bounds.maxX, player.x);
  player.z = clampNumber(msg.z, bounds.minZ, bounds.maxZ, player.z);
  if (player.area === 'main-deck') resolveMainDeckCollisions(room, player);
  player.yaw = clampNumber(msg.yaw, -Math.PI, Math.PI, player.yaw);
  player.movingUntil = msg.moving === false ? 0 : now + 450;
  room.dirty = true;
}
function applyShipSystems(room, team, patch) {
  const ship = room.ships[team];
  if (!ship || !patch || typeof patch !== 'object') return false;
  const allowed = ['engineRunning', 'doorOpen', 'hatchOpen', 'powerOnline', 'coolingOnline', 'reactorOnline'];
  if (allowed.includes(patch.action)) {
    const value = !!patch.value;
    if (patch.action === 'engineRunning') ship.systems.engine.running = value;
    if (patch.action === 'doorOpen') ship.systems.doorOpen = value;
    if (patch.action === 'hatchOpen') ship.systems.hatchOpen = value;
    if (patch.action === 'powerOnline') ship.systems.power.online = value;
    if (patch.action === 'coolingOnline') ship.systems.cooling.online = value;
    if (patch.action === 'reactorOnline') ship.systems.reactor.online = value;
  } else if (patch.action === 'interaction') {
    const key = cleanText(patch.target, 32);
    const valid = ['door', 'hatch', 'table', 'helm', 'engine', 'cooling', 'reactor', 'storage', 'sensor', 'crane', 'windlass', 'capstan'];
    if (!valid.includes(key)) return false;
    ship.systems.lastInteraction = { target: key, value: typeof patch.value === 'boolean' ? patch.value : null, playerId: cleanText(patch.playerId, 80), at: Date.now() };
  } else return false;
  ship.systems.revision++;
  room.dirty = true;
  return true;
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
      return createRoom(ws, msg);
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
      const hostActor = room.players.get(room.hostPlayerId); if (hostActor) hostActor.connected = true;
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
        canJoin: room.status !== 'finished', phase: room.status
      });
      return;
    }

    if (msg.type === 'join') {
      if (session.role) return error(ws, 'This connection is already attached to a room. Leave it or reconnect with a fresh connection.', 'SESSION_EXISTS');
      const code = cleanText(msg.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return error(ws, 'Room not found. Ask the host for the current room code.', 'ROOM_NOT_FOUND');
      return addPlayer(room, ws, msg);
    }

    if (msg.type === 'watch') {
      if (session.role) return error(ws, 'This connection is already attached to a room.', 'SESSION_EXISTS');
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
      if (room.status !== 'racing') return;
      setPlayerPose(room, player, msg);
      return;
    }

    if (msg.type === 'host:move' && session.role === 'host') {
      const hostActor = room.players.get(room.hostPlayerId);
      if (!hostActor) return error(ws, 'Host avatar not found.', 'HOST_PLAYER_NOT_FOUND');
      setPlayerPose(room, hostActor, msg);
      return;
    }

    if (msg.type === 'host:map-geometry' && session.role === 'host') {
      if (room.status !== 'lobby') return;
      const accepted = acceptMapGeometry(room, msg.geometry);
      if (!accepted) return error(ws, 'The projection map geometry could not be validated. Reload the host multiplayer page.', 'MAP_GEOMETRY_INVALID');
      room.dirty = true; broadcast(room); return;
    }

    if (msg.type === 'host:start' && session.role === 'host') {
      if (room.status !== 'lobby') return error(ws, 'The race is not in the lobby.', 'RACE_NOT_IN_LOBBY');
      if (!room.map.geometryReady) return error(ws, 'map.html has not finished registering its map geometry. Keep the host multiplayer page open and retry.', 'MAP_GEOMETRY_NOT_READY');
      const crew = crewPlayers(room);
      if (![...room.players.values()].some(p => p.team === 'A') || ![...room.players.values()].some(p => p.team === 'B')) {
        return error(ws, 'At least one player must be on each ship before starting.', 'BOTH_TEAMS_REQUIRED');
      }
      const notReady = crew.filter(p => !p.ready || !p.ws || p.ws.readyState !== WebSocket.OPEN);
      const hostActor = room.players.get(room.hostPlayerId);
      if (!hostActor || !room.hostWs || room.hostWs.readyState !== WebSocket.OPEN) return error(ws, 'Host avatar is not connected.', 'HOST_NOT_CONNECTED');
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
      if (Number.isFinite(Number(msg.speed))) { ship.throttle = clampNumber(msg.speed, 0, 100, ship.throttle); ship.systems.engine.throttle = ship.throttle; ship.systems.engine.running = ship.throttle > 0; }
      if (Number.isFinite(Number(msg.yaw))) ship.yaw = clampNumber(msg.yaw, -Math.PI, Math.PI, ship.yaw);
      const centerBounds = shipCenterBounds(room, ship);
      const nextX = clampNumber(msg.x, centerBounds.minX, centerBounds.maxX, ship.x);
      const nextZ = clampNumber(msg.z, centerBounds.minZ, centerBounds.maxZ, ship.z);
      const nextYaw = clampNumber(msg.yaw, -Math.PI, Math.PI, ship.yaw);
      if (shipPoseClearOfMap(room, ship, nextX, nextZ, nextYaw)) { ship.x = nextX; ship.z = nextZ; ship.yaw = nextYaw; }
      room.dirty = true; broadcast(room); return;
    }
    if (msg.type === 'ship:control' && session.role === 'player') {
      const player = room.players.get(session.playerId);
      if (!player || room.status !== 'racing') return error(ws, 'Ship controls are available after the game starts.', 'GAME_NOT_STARTED');
      const ship = room.ships[player.team];
      ship.throttle = clampNumber(msg.throttle, 0, 100, ship.throttle);
      ship.rudder = clampNumber(msg.rudder, -35, 35, ship.rudder);
      ship.systems.engine.throttle = ship.throttle;
      ship.systems.engine.rudder = ship.rudder;
      ship.systems.engine.running = ship.throttle > 0;
      ship.systems.revision++;
      room.dirty = true; broadcast(room); return;
    }
    if (msg.type === 'host:control' && session.role === 'host') {
      const team = msg.team === 'B' ? 'B' : 'A';
      const ship = room.ships[team];
      ship.throttle = clampNumber(msg.throttle, 0, 100, ship.throttle);
      ship.rudder = clampNumber(msg.rudder, -35, 35, ship.rudder);
      ship.systems.engine.throttle = ship.throttle;
      ship.systems.engine.rudder = ship.rudder;
      ship.systems.engine.running = ship.throttle > 0;
      ship.systems.revision++;
      room.dirty = true; broadcast(room); return;
    }
    if (msg.type === 'ship:interaction') {
      const player = session.role === 'player' ? room.players.get(session.playerId) : null;
      if (!player) return error(ws, 'Only a joined player can interact with a ship.', 'NOT_AUTHORIZED');
      if (!applyShipSystems(room, player.team, { action: 'interaction', target: msg.target, value: msg.value, playerId: player.id })) return error(ws, 'Unknown ship interaction.', 'INVALID_INTERACTION');
      broadcast(room); return;
    }
    if (msg.type === 'ship:system' && session.role === 'player') {
      const player = room.players.get(session.playerId);
      if (!player) return error(ws, 'Player session not found.', 'PLAYER_NOT_FOUND');
      if (!applyShipSystems(room, player.team, msg)) return error(ws, 'Unknown ship system action.', 'INVALID_SYSTEM_ACTION');
      broadcast(room); return;
    }
    if (msg.type === 'host:system' && session.role === 'host') {
      const team = msg.team === 'B' ? 'B' : 'A';
      if (!applyShipSystems(room, team, msg)) return error(ws, 'Unknown ship system action.', 'INVALID_SYSTEM_ACTION');
      broadcast(room); return;
    }
    if ((msg.type === 'ship:telemetry' && session.role === 'player') || (msg.type === 'host:telemetry' && session.role === 'host')) {
      const player = session.role === 'player' ? room.players.get(session.playerId) : null;
      const team = session.role === 'host' ? 'A' : player?.team;
      if (!team) return error(ws, 'Player session not found.', 'PLAYER_NOT_FOUND');
      const ship = room.ships[team];
      const t = msg.telemetry && typeof msg.telemetry === 'object' ? msg.telemetry : {};
      const telemetry = ship.systems.telemetry || {};
      for (const key of ['shipSpeedKn', 'headingDeg', 'rpm', 'powerKw', 'elecPowerKw', 'temperatureC', 'fuelPercent', 'loadDemandKw']) {
        if (Number.isFinite(Number(t[key]))) telemetry[key] = clampNumber(t[key], key === 'headingDeg' ? 0 : 0, key === 'temperatureC' ? 180 : (key === 'fuelPercent' ? 100 : 100000), 0);
      }
      for (const key of ['mainPower', 'motor1', 'motor2', 'generator', 'clutch', 'lubPump', 'swPump']) {
        if (typeof t[key] === 'boolean') telemetry[key] = t[key];
      }
      telemetry.updatedAt = Date.now();
      ship.systems.telemetry = telemetry;
      ship.systems.revision++;
      room.dirty = true; broadcast(room); return;
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
      if (current.role === 'host' && room.hostWs === ws) { room.hostWs = null; const hostActor = room.players.get(room.hostPlayerId); if (hostActor) hostActor.connected = false; room.dirty = true; broadcast(room); }
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

// Authoritative 20 Hz world simulation. The server owns both ship transforms,
// ship separation, navigation bounds, health and independent ship-system state.
let lastWorldTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, Math.max(0.01, (now - lastWorldTick) / 1000));
  lastWorldTick = now;
  for (const room of rooms.values()) {
    if (room.status === 'racing') {
      for (const team of ['A', 'B']) {
        const ship = room.ships[team];
        const targetSpeed = ship.systems.engine.running ? ship.throttle * 0.075 : 0;
        ship.speed += (targetSpeed - ship.speed) * Math.min(1, dt * 1.6);
        ship.yaw += (ship.rudder / 35) * ship.speed * 0.0032 * dt;
        const centerBounds = shipCenterBounds(room, ship);
        const nextX = clampNumber(ship.x + Math.cos(ship.yaw) * ship.speed * dt * 0.11, centerBounds.minX, centerBounds.maxX, ship.x);
        const nextZ = clampNumber(ship.z + Math.sin(ship.yaw) * ship.speed * dt * 0.11, centerBounds.minZ, centerBounds.maxZ, ship.z);
        if (shipPoseClearOfMap(room, ship, nextX, nextZ, ship.yaw)) {
          ship.x = nextX; ship.z = nextZ; ship.grounded = false;
        } else {
          ship.grounded = true;
          ship.speed *= 0.88;
          ship.hp = Math.max(0, ship.hp - 0.015);
        }
        ship.progress = routeProgress(room.map.route, ship.x, ship.z);
      }
      // Separate hull centres by more than their combined half-lengths.
      const a = room.ships.A, b = room.ships.B;
      const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
      if (distance < SHIP_MIN_SEPARATION) {
        const push = (SHIP_MIN_SEPARATION - distance) / 2;
        const nx = distance > 0.001 ? dx / distance : 1;
        const nz = distance > 0.001 ? dz / distance : 0;
        const aNext = { x: a.x - nx * push, z: a.z - nz * push };
        const bNext = { x: b.x + nx * push, z: b.z + nz * push };
        if (shipPoseClearOfMap(room, a, aNext.x, aNext.z, a.yaw)) { a.x = aNext.x; a.z = aNext.z; }
        if (shipPoseClearOfMap(room, b, bNext.x, bNext.z, b.yaw)) { b.x = bNext.x; b.z = bNext.z; }
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
}, 50);

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
  console.log(`TITAN multiplayer v3 listening on port ${PORT}`);
});
