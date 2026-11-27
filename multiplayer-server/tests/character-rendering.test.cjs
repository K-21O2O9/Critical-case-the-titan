const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('character animation keeps the network-owned world transform intact', () => {
  const runtimeSource = read('character-runtime.js');
  const window = { addEventListener() {}, dispatchEvent() {} };
  const context = { window, localStorage: { getItem() { return null; }, setItem() {} },
    CustomEvent: function CustomEvent() {}, performance: { now: () => 1000 }, Math, Number, String, Object, JSON };
  vm.createContext(context);
  vm.runInContext(runtimeSource, context);
  const rig = {
    visualRoot: { position: { y: 0 } },
    torso: { scale: { y: 1 } },
    head: { rotation: { x: 0, y: 0, z: 0 } },
    arms: {
      left: { upper: { rotation: { x: 0, y: 0, z: 0 } }, elbow: { rotation: { x: 0, y: 0, z: 0 } } },
      right: { upper: { rotation: { x: 0, y: 0, z: 0 } }, elbow: { rotation: { x: 0, y: 0, z: 0 } } }
    },
    legs: {
      left: { hip: { rotation: { x: 0, y: 0, z: 0 } }, knee: { rotation: { x: 0, y: 0, z: 0 } } },
      right: { hip: { rotation: { x: 0, y: 0, z: 0 } }, knee: { rotation: { x: 0, y: 0, z: 0 } } }
    },
    eyes: []
  };
  const model = { position: { x: 1.4, y: 3.2, z: -8.1 }, userData: { rig } };
  context.window.TitanCharacterRuntime.animateModel(model, 1.25, 1, 1);
  assert.deepEqual(model.position, { x: 1.4, y: 3.2, z: -8.1 }, 'animation must not overwrite server-interpolated position');
  assert.ok(rig.visualRoot.position.y > 0, 'idle/walk bob should animate the inner visual rig');
  context.window.TitanCharacterRuntime.animateModel(model, 2.25, 0, 1);
  assert.deepEqual(model.position, { x: 1.4, y: 3.2, z: -8.1 }, 'idle animation must also preserve world position');
});

test('Main Deck remote avatars are anchored to the actual deck and interpolate network transforms', () => {
  const main = read('main-deck.html');
  assert.match(main, /const mpAvatarFloorY = 3\.2/);
  assert.match(main, /new THREE\.Vector3\(Number\(p\.x\) \|\| 0, mpAvatarFloorY, Number\(p\.z\) \|\| 0\)/);
  assert.match(main, /actor\.target\.set\(Number\(p\.x\) \|\| 0, mpAvatarFloorY, Number\(p\.z\) \|\| 0\)/);
  assert.match(main, /actor\.model\.position\.lerp\(actor\.target, lerpFactor\)/);
  const character = read('character-runtime.js');
  assert.match(character, /visualRoot\.position\.y = Math\.abs\(Math\.sin/);
  assert.doesNotMatch(character, /model\.position\.y\s*=/);
});

test('walking and sprint state is carried through the server snapshot for remote animation', () => {
  const main = read('main-deck.html');
  const server = read('multiplayer-server/server.js');
  const engine = read('engine-room.html');
  const direct = read('titan-multiplayer-runtime.js');
  assert.match(main, /running: titanRunAmount > \.02/);
  assert.match(main, /actor\.running = actor\.moving && !!p\.running/);
  assert.match(server, /movingUntil: p\.movingUntil \|\| 0, running: !!p\.running/);
  assert.match(server, /player\.running = msg\.moving === false \? false : !!msg\.running/);
  assert.match(engine, /actor\.running = actor\.moving && !!p\.running/);
  assert.match(direct, /setPose\(pose\.x, pose\.z, pose\.yaw, playerArea,[\s\S]*?!!pose\.running\)/);
});

test('server commits walking and running flags with the same authoritative player pose', () => {
  const server = read('multiplayer-server/server.js');
  const start = server.indexOf('function saveActiveAreaPose(');
  const end = server.indexOf('\nfunction commitActionPose(', start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const helpers = server.slice(start, end);
  const context = {
    Date, Math,
    AREA_BOUNDS: { 'main-deck': { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 } },
    DECK_BOUNDS: { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.1 },
    clampNumber(value, min, max, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; },
    resolveMainDeckCollisions() {}
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nthis.setPlayerPose = setPlayerPose;`, context);
  const room = { dirty: false };
  const player = { x: 0, z: 0, yaw: 0, area: 'main-deck', lastMoveAt: 0 };
  context.setPlayerPose(room, player, { x: 1, z: -2, yaw: .5, area: 'main-deck', moving: true, running: true }, true);
  assert.equal(player.running, true);
  assert.ok(player.movingUntil > Date.now());
  context.setPlayerPose(room, player, { x: 1.1, z: -2.1, yaw: .6, area: 'main-deck', moving: false, running: false }, true);
  assert.equal(player.running, false);
  assert.equal(player.movingUntil, 0);
});
