const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced function ${name}`);
}

test('ordinary room snapshots do not reposition the local player', () => {
  const main = read('main-deck.html');
  const runtime = read('titan-multiplayer-runtime.js');
  assert.match(main, /if \(self && !mpHasAppliedInitialPose\)/);
  assert.doesNotMatch(main, /largeDesync|dist\s*>\s*4\.5|self\.forceRespawn/);
  assert.doesNotMatch(runtime, /dist\s*>\s*4\.5|setMultiplayerPose\(self\.x/);
});

test('Main Deck includes the current pose with interaction events', () => {
  const main = read('main-deck.html');
  assert.match(main, /outgoing\.type === 'INTERACTION'[\s\S]*?outgoing\.pose\s*=/);
});

test('direct and embedded multiplayer bridges forward interaction and transition poses', () => {
  const runtime = read('titan-multiplayer-runtime.js');
  const lobby = read('multiplayer.html');
  const main = read('main-deck.html');
  assert.match(runtime, /send\('ship:interaction', \{ target: payload\.target, value: payload\.value, pose: pose \}\)/);
  assert.match(runtime, /send\('ship:system', \{ action: payload\.action, value: !!payload\.value, pose: pose \}\)/);
  assert.match(lobby, /target:d\.target,value:d\.value,pose/);
  assert.match(lobby, /SHIP_CONTROL'[\s\S]*?pose=playerPose/);
  assert.match(lobby, /AREA_CHANGE'[\s\S]*?pose=d\.pose/);
  assert.match(main, /type: 'AREA_CHANGE', area: area, pose: pose/);
});

test('server forced interaction pose bypasses movement throttle and commits bounded pose', () => {
  const server = read('multiplayer-server/server.js');
  const helper = [extractFunction(server, 'saveActiveAreaPose'), extractFunction(server, 'setPlayerPose')].join('\n');
  const context = {
    Date,
    DECK_BOUNDS: { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 },
    AREA_BOUNDS: {
      'main-deck': { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 },
      'engine-room': { minX: -13.2, maxX: 13.2, minZ: -6.6, maxZ: 6.6 },
      storage: { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 }
    },
    clampNumber(value, min, max, fallback = 0) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    },
    resolveMainDeckCollisions() {}
  };
  vm.createContext(context);
  vm.runInContext(`${helper}\nthis.setPlayerPose = setPlayerPose;`, context);

  const room = { dirty: false, ships: { A: { systems: { doorOpen: true, hatchOpen: false } } } };
  const player = { team: 'A', x: 0.85, z: -14.35, yaw: 0, area: 'main-deck', lastMoveAt: Date.now() };
  const original = { x: player.x, z: player.z };
  assert.equal(context.setPlayerPose(room, player, { x: 1, z: -10, yaw: 0.2, area: 'main-deck' }), false);
  assert.deepEqual({ x: player.x, z: player.z }, original, 'normal movement is still rate-limited');

  assert.equal(context.setPlayerPose(room, player, { x: 2.4, z: -5.2, yaw: 0.75, area: 'main-deck', moving: false }, true), true);
  assert.equal(player.x, 2.4);
  assert.equal(player.z, -5.2);
  assert.equal(player.yaw, 0.75);
  assert.equal(player.movingUntil, 0);
  assert.equal(room.dirty, true);
});

test('server mutation handlers commit pose before the room broadcast', () => {
  const server = read('multiplayer-server/server.js');
  const helper = extractFunction(server, 'commitActionPose');
  assert.match(helper, /msg\.pose[\s\S]*?setPlayerPose\(room, player, msg\.pose, true\)/);
  for (const marker of ["if (msg.type === 'ship:interaction')", "if (msg.type === 'ship:system'", "if (msg.type === 'host:system'", "if (msg.type === 'ship:control'", "if (msg.type === 'host:control'", "if ((msg.type === 'ship:telemetry'"]) {
    const start = server.indexOf(marker);
    assert.notEqual(start, -1, `missing handler ${marker}`);
    const region = server.slice(start, start + 1500);
    assert.match(region, /commitActionPose\(room,/);
    assert.ok(region.indexOf('commitActionPose') < region.indexOf('broadcast(room)'), 'pose must be applied before broadcast');
  }
});


test('server stores and restores independent poses for every HTML room area', () => {
  const server = read('multiplayer-server/server.js');
  const helpers = [
    extractFunction(server, 'saveActiveAreaPose'),
    extractFunction(server, 'defaultAreaPose'),
    extractFunction(server, 'changePlayerArea'),
    extractFunction(server, 'setPlayerPose')
  ].join('\n');
  const context = {
    Math, Date,
    AREA_BOUNDS: {
      'main-deck': { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 },
      'engine-room': { minX: -13.2, maxX: 13.2, minZ: -6.6, maxZ: 6.6 },
      storage: { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 }
    },
    clampNumber(value, min, max, fallback = 0) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    },
    teamCount() { return 0; },
    resolveMainDeckCollisions() {}
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nthis.changePlayerArea=changePlayerArea; this.setPlayerPose=setPlayerPose;`, context);
  const room = { dirty: false };
  const player = { id: 'p1', team: 'A', x: 1.2, z: -8.4, yaw: 0.4, area: 'main-deck', lastMoveAt: 0, movingUntil: 0 };
  assert.equal(context.changePlayerArea(room, player, 'engine-room'), true);
  assert.equal(player.area, 'engine-room');
  assert.deepEqual({ x: player.x, z: player.z, yaw: player.yaw }, { x: -2.2, z: 1.8, yaw: 0 });
  context.setPlayerPose(room, player, { area: 'engine-room', x: 5.5, z: -2.2, yaw: 1.1, moving: true }, true);
  assert.equal(context.changePlayerArea(room, player, 'main-deck'), true);
  assert.deepEqual({ x: player.x, z: player.z, yaw: player.yaw }, { x: 1.2, z: -8.4, yaw: 0.4 });
  assert.equal(context.changePlayerArea(room, player, 'engine-room'), true);
  assert.deepEqual({ x: player.x, z: player.z, yaw: player.yaw }, { x: 5.5, z: -2.2, yaw: 1.1 });
});

test('legacy transition packets cannot reinterpret source coordinates as destination coordinates', () => {
  const server = read('multiplayer-server/server.js');
  const helpers = [extractFunction(server, 'saveActiveAreaPose'), extractFunction(server, 'defaultAreaPose'), extractFunction(server, 'changePlayerArea'), extractFunction(server, 'setPlayerPose')].join('\n');
  const context = {
    Math, Date,
    AREA_BOUNDS: {
      'main-deck': { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 },
      'engine-room': { minX: -13.2, maxX: 13.2, minZ: -6.6, maxZ: 6.6 }, storage: { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 }
    },
    clampNumber(value, min, max, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; },
    teamCount() { return 0; }, resolveMainDeckCollisions() {}
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nthis.setPlayerPose=setPlayerPose;`, context);
  const player = { id: 'p1', team: 'A', x: 2.8, z: -10.1, yaw: -0.6, area: 'main-deck', lastMoveAt: 0 };
  context.setPlayerPose({ dirty: false }, player, { x: 2.8, z: -10.1, yaw: -0.6, area: 'engine-room', transition: true, moving: false }, true);
  assert.equal(player.area, 'engine-room');
  assert.deepEqual({ x: player.x, z: player.z, yaw: player.yaw }, { x: -2.2, z: 1.8, yaw: 0 });
});

test('Engine Room uses one idempotent frame loop and shared character scaling', () => {
  const engine = read('engine-room.html');
  const bus = read('titan-ship-bus.js');
  assert.match(engine, /if \(this\.running\) return;/);
  assert.match(engine, /window\.__titanTickEngineCrew = tickEngineCrew/);
  assert.match(engine, /window\.__titanRudderPhysicsStep = rudderPhysicsStep/);
  assert.doesNotMatch(engine, /requestAnimationFrame\(rudderPhysics\)/);
  assert.doesNotMatch(engine, /setInterval\(\(\) => \{\s*updateEngineCrew/);
  assert.match(engine, /createModel\(THREE, player\.character \|\| \{\}, \{ scale: \.78 \}\)/);
  assert.match(engine, /<script src="character-runtime\.js"><\/script>/);
  assert.match(bus, /startEnginePublisher[\s\S]*?this\.stopEnginePublisher\(\)/);
});

test('Engine Room low-quality profile is selected before renderer creation', () => {
  const engine = read('engine-room.html');
  assert.match(engine, /SceneManager\.quality = levels\[qIdx\];[\s\S]*?SceneManager\.init\(host\)/);
  assert.match(engine, /antialias: this\.quality !== "low"/);
  assert.match(engine, /if \(this\.quality === "high"\).*?_setupPostFX/s);
  assert.match(engine, /if \(this\.quality !== "low"\).*?_setupSteam/s);
  assert.match(engine, /if \(this\.quality === "low"\)[\s\S]*?return;[\s\S]*?const count = 60/);
});

test('reconnect snapshots retain short-lived player visibility and area poses', () => {
  const server = read('multiplayer-server/server.js');
  assert.match(server, /PLAYER_VISIBILITY_GRACE_MS = 3_500/);
  assert.match(server, /connected: p\.isHost \?[\s\S]*?: !!p\.connected/);
  assert.match(server, /player\.visibilityTimer = setTimeout/);
  assert.match(server, /poses: p\.poses \|\| \{\}/);
  assert.match(server, /msg\.type === 'player:area'/);
});

test('embedded and standalone navigation use explicit room-area membership changes', () => {
  const server = read('multiplayer-server/server.js');
  const lobby = read('multiplayer.html');
  const engine = read('engine-room.html');
  const storage = read('storage.html');
  assert.match(server, /msg\.type === 'host:area'[\s\S]*?changePlayerArea\(room, hostActor, msg\.area\)/);
  assert.match(lobby, /type:'host:area',area:d\.area,pose/);
  assert.match(lobby, /type:'player:area',area:d\.area,pose/);
  assert.match(engine, /type: 'AREA_CHANGE', area: destinationArea, pose: sourcePose/);
  assert.match(storage, /type: 'AREA_CHANGE', area: destinationArea, pose: null/);
});

test('standalone area transition never reuses a pose cached for another area', () => {
  const runtime = read('titan-multiplayer-runtime.js');
  assert.match(runtime, /var lastPoseArea = null/);
  assert.match(runtime, /lastPose && lastPoseArea === previousArea[\s\S]*?send\('player:area'/);
  assert.match(runtime, /lastPose && lastPoseArea === playerArea/);
  assert.match(runtime, /lastPoseArea = playerArea/);
});
