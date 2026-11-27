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

function serverComponentHarness() {
  const server = read('multiplayer-server/server.js');
  const schemaStart = server.indexOf('const ENGINE_COMPONENT_SCHEMA');
  const schemaEnd = server.indexOf('\n\nfunction defaultEngineTelemetry()', schemaStart);
  assert.ok(schemaStart >= 0 && schemaEnd > schemaStart, 'engine component schema exists');
  const selected = [
    server.slice(schemaStart, schemaEnd),
    extractFunction(server, 'defaultEngineTelemetry'),
    extractFunction(server, 'makeShip'),
    extractFunction(server, 'applyEngineComponent')
  ].join('\n');
  const context = {
    Date, Number, Object,
    DECK_BOUNDS: { minX: -3.9, maxX: 3.9, minZ: -17.65, maxZ: 22.10 },
    clampNumber(value, min, max, fallback = 0) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${selected}\nthis.schema = ENGINE_COMPONENT_SCHEMA; this.defaultEngineTelemetry = defaultEngineTelemetry; this.makeShip = makeShip; this.applyEngineComponent = applyEngineComponent;`, context);
  return context;
}

test('server defines all 16 stable engine component IDs with explicit value types and ranges', () => {
  const h = serverComponentHarness();
  const ids = Object.keys(h.schema).sort();
  assert.deepEqual(ids, [
    'airIntake', 'autoReg', 'aux', 'clutch', 'fuelFeed', 'generator', 'h2oCooler', 'lubCooler',
    'lubPump', 'mainPower', 'motor1', 'motor2', 'starter', 'swPump', 'targetRpm', 'throttle'
  ].sort());
  for (const id of ['mainPower','motor1','motor2','starter','aux','generator','clutch','lubPump','swPump','autoReg']) {
    assert.equal(h.schema[id].type, 'boolean', `${id} is boolean`);
  }
  for (const id of ['lubCooler','h2oCooler','fuelFeed','airIntake','throttle']) {
    assert.deepEqual({ type: h.schema[id].type, min: h.schema[id].min, max: h.schema[id].max }, { type: 'number', min: 0, max: 100 });
  }
  assert.deepEqual({ type: h.schema.targetRpm.type, min: h.schema.targetRpm.min, max: h.schema.targetRpm.max }, { type: 'number', min: 0, max: 1200 });
});

test('server ship snapshots own independent complete initial component states', () => {
  const h = serverComponentHarness();
  const a = h.makeShip('A');
  const b = h.makeShip('B');
  assert.equal(a.systems.telemetry.mainPower, false);
  assert.equal(a.systems.telemetry.motor1, false);
  assert.equal(a.systems.telemetry.lubCooler, 60);
  assert.equal(a.systems.telemetry.h2oCooler, 55);
  assert.equal(a.systems.telemetry.fuelFeed, 10);
  assert.equal(a.systems.telemetry.airIntake, 50);
  assert.equal(a.systems.telemetry.throttle, 30);
  assert.equal(a.systems.telemetry.targetRpm, 400);
  assert.notEqual(a.systems.telemetry, b.systems.telemetry, 'Ship A and Ship B do not share a mutable component object');
});

test('authoritative component writes validate, clamp, increment revision and mirror throttle', () => {
  const h = serverComponentHarness();
  const ship = h.makeShip('A');
  for (const id of ['mainPower','motor1','motor2','starter','aux','generator','clutch','lubPump','swPump','autoReg']) {
    assert.equal(h.applyEngineComponent(ship, id, true), true, `${id} accepts boolean ON`);
    assert.equal(ship.systems.telemetry[id], true);
  }
  assert.equal(h.applyEngineComponent(ship, 'lubCooler', 110), true);
  assert.equal(ship.systems.telemetry.lubCooler, 100);
  assert.equal(h.applyEngineComponent(ship, 'h2oCooler', -10), true);
  assert.equal(ship.systems.telemetry.h2oCooler, 0);
  assert.equal(h.applyEngineComponent(ship, 'fuelFeed', 45), true);
  assert.equal(h.applyEngineComponent(ship, 'airIntake', 35), true);
  assert.equal(h.applyEngineComponent(ship, 'throttle', 72), true);
  assert.equal(ship.throttle, 72);
  assert.equal(ship.systems.engine.throttle, 72);
  assert.equal(ship.systems.engine.running, true);
  assert.equal(h.applyEngineComponent(ship, 'targetRpm', 2000), true);
  assert.equal(ship.systems.telemetry.targetRpm, 1200);
  const revision = ship.systems.revision;
  assert.equal(h.applyEngineComponent(ship, 'targetRpm', 'not-a-number'), false);
  assert.equal(h.applyEngineComponent(ship, 'motor1', 1), false, 'boolean components reject numeric values');
  assert.equal(h.applyEngineComponent(ship, 'unknownPart', true), false);
  assert.equal(ship.systems.revision, revision, 'invalid writes do not mutate state or revision');
  assert.equal(h.applyEngineComponent(ship, 'throttle', 0), true);
  assert.equal(ship.systems.engine.running, false, 'zero throttle clears engine running state');
});

test('room handler publishes each accepted component write as the whole authoritative snapshot', () => {
  const server = read('multiplayer-server/server.js');
  const start = server.indexOf("if ((msg.type === 'ship:component'");
  assert.ok(start >= 0, 'player and host component handler exists');
  const region = server.slice(start, start + 1700);
  assert.match(region, /session\.role === 'host' \? \(msg\.team === 'B' \? 'B' : 'A'\) : player\.team/);
  assert.match(region, /applyEngineComponent\(ship, cleanText\(msg\.componentId, 40\), msg\.value\)/);
  assert.match(region, /commitActionPose\(room, player, msg\.pose \? msg : null\)/);
  assert.ok(region.indexOf('room.dirty = true') < region.indexOf('broadcast(room)'), 'state is committed before broadcasting');
  assert.match(server, /send\(ws, 'joined', \{ playerId: deviceId, team, state: getSnapshot\(room\) \}\)/);
  assert.match(server, /send\(ws, 'created', \{ code, state: getSnapshot\(room\) \}\)/);
});

test('all engine-room switches and sliders publish stable component IDs exactly once', () => {
  const engine = read('engine-room.html');
  for (const id of ['mainPower','motor1','motor2','starter','aux','generator','clutch','lubPump','swPump','autoReg']) {
    assert.match(engine, new RegExp(`componentIds[\\s\\S]{0,380}${id}`), `${id} is mapped from a switch`);
  }
  for (const [htmlId, componentId] of [
    ['slider-lub-cooler','lubCooler'], ['slider-h2o-cooler','h2oCooler'], ['slider-fuel','fuelFeed'],
    ['slider-air','airIntake'], ['slider-throttle','throttle'], ['slider-rpm','targetRpm']
  ]) {
    assert.match(engine, new RegExp(`bindSlider\\("${htmlId}"[\\s\\S]{0,150}"${componentId}"`));
  }
  assert.match(engine, /el\.dataset\.titanBound === "1"/);
  assert.match(engine, /input\.dataset\.componentId = a\.id/);
  assert.match(engine, /sendCommand\(componentMeta\[0\], v, \{ key: componentMeta\[1\], componentId: id \}\)/);
});

test('Main Deck renders authoritative engine flags and setpoints including valid zero values', () => {
  const main = read('main-deck.html');
  for (const id of ['eng-target-rpm','eng-fuel-feed','eng-air-intake','eng-lub-cooler','eng-h2o-cooler','eng-voltage','eng-current','eng-elec-power','eng-bus-power','eng-pressure','eng-flow','eng-fuel-flow','eng-fuel-kg','eng-density','eng-vol-flow','eng-omega','eng-torque','eng-mech-power','eng-coolant-level','eng-coolant-quality','eng-filter-dp']) {
    assert.match(main, new RegExp(`id="${id}"`), `${id} dashboard field exists`);
  }
  for (const key of ['main','motor1','motor2','starter','aux','gen','clutch','lub','sw','autoReg']) {
    assert.match(main, new RegExp(`data-k="${key}"`), `${key} operational flag exists`);
  }
  assert.match(main, /shipBus\.on\('telemetry'[\s\S]*?updateEnginePanelUI/);
  assert.match(main, /t\.motors && t\.motors\.targetRpm != null \? t\.motors\.targetRpm/);
  assert.match(main, /t\.reactor && t\.reactor\.fuelFeed != null \? t\.reactor\.fuelFeed/);
});


test('Engine Room multiplayer ship bus applies snapshots without echoing and forwards component writes', () => {
  const busSource = read('titan-ship-bus.js');
  const listeners = {};
  const parentMessages = [];
  const parent = { postMessage(message, origin) { parentMessages.push({ message, origin }); } };
  const window = {
    location: { search: '?multiplayer=1&team=B', origin: 'https://titan.test', pathname: '/engine-room.html' },
    parent,
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener() {},
    TitanMultiplayerRuntime: null
  };
  const context = {
    window, URLSearchParams, Date, Number, Object, Math, String,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    localStorage: { getItem() { throw new Error('multiplayer bus must not seed local storage'); }, setItem() { throw new Error('multiplayer bus must not write local storage'); } }
  };
  vm.createContext(context);
  vm.runInContext(busSource, context);
  const bus = window.createTitanShipBus('engine');
  const applied = [];
  bus.setCommandHandler(command => applied.push(command));
  const telemetry = {
    mainPower: true, motor1: true, motor2: false, starter: true, aux: false,
    generator: true, clutch: false, lubPump: true, swPump: false, autoReg: true,
    lubCooler: 44, h2oCooler: 66, fuelFeed: 20, airIntake: 80, throttle: 72, targetRpm: 950,
    voltage: 440, current: 12, powerKw: 3, coolantLevel: 90, coolantQuality: 88,
    filterDeltaP: .3, machineHeat: { electrics: 4, reactor: 5, regulator: 6, motors: 7 },
    condition: 'warning', activeFaults: ['coolant_low'], updatedAt: 12345, speed: 2.5
  };
  listeners.message({
    origin: 'https://titan.test',
    data: { source: 'TITAN_MULTIPLAYER', type: 'STATE', packet: { state: { ships: { B: { systems: { telemetry, engine: { rudder: 5 } } } } } } }
  });
  assert.equal(bus._mpHasAuthoritativeState, true);
  assert.equal(applied.length, 18, 'sixteen components, rudder and authoritative metric snapshot are applied');
  const metricSnapshot = applied.find(command => command.action === 'applyTelemetrySnapshot');
  assert.ok(metricSnapshot, 'engine game receives the latest authoritative sensor snapshot');
  assert.equal(metricSnapshot.telemetry.voltage, 440);
  assert.equal(metricSnapshot.telemetry.condition, 'warning');
  assert.deepEqual(Array.from(metricSnapshot.telemetry.activeFaults), ['coolant_low']);
  assert.equal(bus.telemetry.electrics.main, true);
  assert.equal(bus.telemetry.electrics.motor2, false);
  assert.equal(bus.telemetry.cooling.lubCooler, 44);
  assert.equal(bus.telemetry.reactor.fuelFeed, 20);
  assert.equal(bus.telemetry.motors.targetRpm, 950);
  assert.equal(bus.telemetry.regulator.throttle, 72);
  assert.equal(bus.telemetry.machineHeat.motors, 7);

  bus.sendCommand('setCooling', 51, { key: 'lubCooler', componentId: 'lubCooler' });
  assert.equal(parentMessages.at(-1).message.source, 'TITAN_SHIP_BUS');
  assert.equal(parentMessages.at(-1).message.payload.componentId, 'lubCooler');
  assert.equal(parentMessages.at(-1).message.payload.value, 51);

  bus.publishTelemetry({ temperatureC: 55, mainPower: false, lubCooler: 15, cooling: { coolantLevel: 82 } });
  const metricMessage = parentMessages.at(-1).message;
  assert.equal(metricMessage.type, 'TELEMETRY');
  assert.equal(metricMessage.telemetry.temperatureC, 55);
  assert.equal(metricMessage.telemetry.coolantLevel, 82);
  assert.equal(Object.hasOwn(metricMessage.telemetry, 'mainPower'), false, 'heartbeat cannot overwrite a component switch');
  assert.equal(Object.hasOwn(metricMessage.telemetry, 'lubCooler'), false, 'heartbeat cannot overwrite a numeric setpoint');
  bus.destroy();
});
