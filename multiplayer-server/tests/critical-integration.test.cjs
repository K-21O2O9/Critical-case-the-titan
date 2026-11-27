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
  let depth = 0, quote = null, escaped = false;
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
function poseHarness() {
  const server = read('multiplayer-server/server.js');
  const helpers = [extractFunction(server, 'saveActiveAreaPose'), extractFunction(server, 'setPlayerPose')].join('\n');
  const context = {
    Date, Math,
    AREA_BOUNDS: { 'main-deck': { minX: -20, maxX: 20, minZ: -20, maxZ: 20 } },
    DECK_BOUNDS: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
    clampNumber(value, min, max, fallback = 0) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    },
    resolveMainDeckCollisions() {}
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nthis.setPlayerPose=setPlayerPose;`, context);
  return context.setPlayerPose;
}

test('server movement axes follow the canonical -Z forward convention at every yaw', () => {
  const setPose = poseHarness();
  const room = { dirty: false };
  const player = { x: 0, z: 0, yaw: 0, area: 'main-deck', lastMoveAt: 0, poses: {} };
  // Forward at yaw zero is world -Z.
  setPose(room, player, { x: 0, z: -1, yaw: 0, area: 'main-deck', moving: true }, true);
  assert.ok(player.moveForward > .999);
  assert.ok(Math.abs(player.moveStrafe) < .001);
  // Backward is world +Z.
  setPose(room, player, { x: 0, z: 0, yaw: 0, area: 'main-deck', moving: true }, true);
  assert.ok(player.moveForward < -.999);
  // A yaw of +PI/2 points forward to world -X.
  setPose(room, player, { x: -1, z: 0, yaw: Math.PI / 2, area: 'main-deck', moving: true }, true);
  assert.ok(player.moveForward > .999);
  // At yaw zero, +X is right strafe.
  player.x = 0; player.z = 0; player.yaw = 0;
  setPose(room, player, { x: 1, z: 0, yaw: 0, area: 'main-deck', moving: true }, true);
  assert.ok(player.moveStrafe > .999);
});

test('avatar schema and model declare a single -Z forward axis with male/female and outfit variants', () => {
  const runtime = read('character-runtime.js');
  const creator = read('character-creator.html');
  const server = read('multiplayer-server/server.js');
  assert.match(runtime, /FORWARD_AXIS: '-Z'/);
  assert.match(runtime, /c\.gender = \['male', 'female'\]/);
  assert.match(runtime, /new THREE\.LatheGeometry\(profile, 20\)/);
  assert.match(runtime, /AVATAR_GEOMETRY: 'low-poly-lathe-humanoid'/);
  assert.match(server, /gender: \['male', 'female'\]/);
  assert.match(creator, /value="male"/);
  assert.match(creator, /value="female"/);
  assert.match(creator, /outfitStyle/);
  // Face elements use negative Z, matching the world forward vector at yaw 0.
  assert.match(runtime, /'Eye_White',[\s\S]{0,100}-\.258/);
  assert.match(runtime, /'Nose',[\s\S]{0,60}-\.286/);
});

test('host participation reuses the room host actor and retains host control navigation', () => {
  const lobby = read('multiplayer.html');
  const server = read('multiplayer-server/server.js');
  assert.match(lobby, /hostJoinEnabled=true/);
  assert.match(lobby, /enterGameSession\(true\)/);
  assert.match(lobby, /hostPlayerId/);
  assert.match(lobby, /HOST CONTROL/);
  assert.match(lobby, /\$\('host-join-game'\)\.onclick=hostJoinGame/);
  assert.match(lobby, /\$\('host-return-game'\)\.onclick=returnHostToGame/);
  assert.match(lobby, /\$\('host-control'\)\.onclick=showHostDashboard/);
  assert.match(server, /const id = 'host-' \+ room\.code/);
  assert.match(server, /room\.players\.get\(room\.hostPlayerId\)/);
  assert.doesNotMatch(lobby, /type:\s*['"]host:create-player['"]/);
});

test('Main Deck shares non-voice settings and exposes the embedded character workshop', () => {
  const main = read('main-deck.html');
  const engine = read('engine-room.html');
  const shared = read('titan-shared-settings.js');
  assert.match(main, /titan-shared-settings\.js/);
  assert.match(engine, /titan-shared-settings\.js/);
  assert.match(main, /character-creator\.html\?embedded=1/);
  assert.match(engine, /character-creator\.html\?embedded=1/);
  assert.match(main, /set-quality/);
  assert.match(main, /set-fov/);
  assert.match(main, /set-controller-profile/);
  assert.match(main, /set-controller-deadzone/);
  assert.match(shared, /Voice bindings and assistant-only configuration are deliberately excluded/);
  const settingsPanel = main.slice(main.indexOf('id="settings-panel"'), main.indexOf('id="character-editor-panel"'));
  assert.doesNotMatch(settingsPanel, /assistant voice|voice activation|voice playback/i);
});

test('shared settings persist common values across page contexts and reject assistant voice fields', () => {
  const sharedSource = read('titan-shared-settings.js');
  const store = new Map();
  function boot() {
    const window = {};
    const localStorage = {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); }
    };
    const context = { window, localStorage, Object, Number, String, Math, JSON };
    vm.createContext(context);
    vm.runInContext(sharedSource, context);
    return window.TitanSharedSettings;
  }
  const deckSettings = boot();
  deckSettings.update({ quality: 'LOW', shadows: false, fov: 88, sensitivity: 1.4 });
  deckSettings.setControls({ padProfile: 'custom', moveStick: 'right', bindings: { interact: { type: 'button', index: 2 }, voice: { type: 'button', index: 8 } } });
  const engineSettings = boot();
  assert.equal(engineSettings.get('quality'), 'LOW');
  assert.equal(engineSettings.get('shadows'), false);
  assert.equal(engineSettings.get('fov'), 88);
  assert.equal(engineSettings.get('sensitivity'), 1.4);
  assert.equal(engineSettings.getControls().padProfile, 'custom');
  assert.deepEqual(Object.keys(engineSettings.getControls().bindings).sort(), [
    'back','forward','fullscreen','interact','left','lookDown','lookLeft','lookRight','lookUp',
    'menuConfirm','menuDown','menuLeft','menuRight','menuUp','right'
  ].sort());
  assert.equal(engineSettings.getControls().bindings.interact.index, 2);
  assert.equal(Object.hasOwn(engineSettings.getControls().bindings, 'voice'), false);
});

test('procedural male and female avatars instantiate their shared low-poly runtime geometry', () => {
  const THREE = require('../../three.min.js');
  const runtimeWindow = { dispatchEvent() {} };
  const context = {
    window: runtimeWindow,
    localStorage: { getItem() { return null; }, setItem() {} },
    CustomEvent: function () {}, performance: { now() { return 0; } },
    Math, Number, String, Object, JSON
  };
  vm.createContext(context);
  vm.runInContext(read('character-runtime.js'), context);
  const runtime = runtimeWindow.TitanCharacterRuntime;
  for (const gender of ['male', 'female']) {
    const model = runtime.createModel(THREE, { gender, outfitStyle: 'engineering', hairStyle: 'braid', accessory: 'headset' });
    let meshCount = 0, torso = null, eyes = 0;
    model.traverse(object => {
      if (object.isMesh) meshCount++;
      if (object.name === 'Torso') torso = object;
      if (object.name === 'Eye_White') eyes++;
    });
    assert.ok(torso && torso.geometry instanceof THREE.LatheGeometry);
    assert.equal(eyes, 2);
    assert.ok(meshCount >= 40);
    runtime.animateModel(model, 1, 1, 1, { moveForward: 1, moveStrafe: 0 });
    assert.ok(model.userData.rig.legs.left.hip.rotation.x > 0, 'forward locomotion drives the forward stride');
    assert.ok(model.userData.rig.legs.right.hip.rotation.x < 0, 'forward locomotion counter-swings the opposite leg');
    runtime.animateModel(model, 1, 1, 1, { moveForward: -1, moveStrafe: 0 });
    assert.ok(model.userData.rig.legs.left.hip.rotation.x < 0, 'backward locomotion reverses the stride');
    assert.ok(model.userData.rig.legs.right.hip.rotation.x > 0, 'backward locomotion reverses both legs consistently');
    assert.equal(model.position.y, 0, 'animation must not mutate the network-owned root transform');
  }
});
