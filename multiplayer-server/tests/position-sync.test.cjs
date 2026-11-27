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
  const helper = extractFunction(server, 'setPlayerPose');
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
