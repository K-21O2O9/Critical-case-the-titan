/**
 * Titan Ship Bus — real-time bridge between Main Deck and Engine Room
 * Uses BroadcastChannel + localStorage so separate HTML pages stay in sync
 * on the same origin (file:// or http(s)).
 */
(function (global) {
  'use strict';

  const CHANNEL = 'titan-ship-bus-v1';
  const STORAGE_KEY = 'titan-ship-telemetry-v1';
  const CMD_KEY = 'titan-ship-cmd-v1';
  const HEARTBEAT_MS = 400;
  const STALE_MS = 2500;

  function now() { return Date.now(); }

  const defaultTelemetry = () => ({
    ts: 0,
    source: 'none',
    connected: false,
    throttle: 0,
    rudder: 0,
    shipSpeedKn: 0,
    headingDeg: 0,
    rpm: 0,
    powerKw: 0,
    elecPowerKw: 0,
    temperatureC: 42,
    fuelPercent: 100,
    fuelRemainingKg: 5000,
    loadDemandKw: 120,
    condition: 'normal',
    voltage: 0, current: 0, pressureBar: 1.0, torqueNm: 0,
    flowLmin: 0, fuelMassFlow: 0, omega: 0, mechPowerKw: 0, busPowerKw: 0, volFlow: 0, density: 0.85,
    lubCooler: 60, h2oCooler: 55, fuelFeed: 10, airIntake: 50, targetRpm: 400,
    coolantLevel: 100, coolantQuality: 100, filterDeltaP: 0.2,
    electrics: { main: false, motor1: false, motor2: false, starter: false, aux: false },
    cooling: { lubPump: false, swPump: false, lubCooler: 60, h2oCooler: 55, coolantLevel: 100, coolantQuality: 100, filterDeltaP: 0.2 },
    reactor: { fuelFeed: 10, airIntake: 50, generator: false },
    motors: { targetRpm: 400, clutch: false },
    regulator: { throttle: 0, autoReg: false },
    machineHeat: { electrics: 0, reactor: 0, regulator: 0, motors: 0 },
    latitude: 25.2048,
    longitude: 55.2708
  });

  function TitanShipBus(role) {
    this.role = role || 'unknown';
    this.telemetry = defaultTelemetry();
    this._listeners = { telemetry: [], command: [], status: [] };
    this._bc = null;
    this._lastRx = 0;
    this._heartbeat = null;
    this._publishFn = null;
    this._cmdHandler = null;
    this._mpParams = new URLSearchParams(window.location.search);
    this._mpEmbedded = this._mpParams.get('multiplayer') === '1' && window.parent !== window;
    this._mpDirect = !this._mpEmbedded && !!(window.TitanMultiplayerRuntime && window.TitanMultiplayerRuntime.active);
    this._mpEnabled = this._mpEmbedded || this._mpDirect;
    this._mpTeam = this._mpParams.get('team') === 'B' ? 'B' : (window.TitanMultiplayerRuntime?.session?.team === 'B' ? 'B' : 'A');
    this._mpHasAuthoritativeState = false;
    this._mpStateHandler = (ev) => {
      if (!this._mpEnabled || ev.origin !== window.location.origin || !ev.data || ev.data.source !== 'TITAN_MULTIPLAYER' || ev.data.type !== 'STATE') return;
      const ship = ev.data.packet && ev.data.packet.state && ev.data.packet.state.ships && ev.data.packet.state.ships[this._mpTeam];
      const systems = ship && ship.systems;
      const telemetry = systems && systems.telemetry;
      if (!telemetry || typeof telemetry !== 'object') return;

      // The room server is authoritative. Apply each changed component locally
      // without sending it back, so snapshots cannot create echo loops.
      if (this.role === 'engine' && this._cmdHandler) {
        const controls = [
          ['mainPower', 'setElectrics', 'main'], ['motor1', 'setElectrics', 'motor1'],
          ['motor2', 'setElectrics', 'motor2'], ['starter', 'setElectrics', 'starter'],
          ['aux', 'setElectrics', 'aux'], ['generator', 'setReactor', 'generator'],
          ['clutch', 'setMotors', 'clutch'], ['lubPump', 'setCooling', 'lubPump'],
          ['swPump', 'setCooling', 'swPump'], ['autoReg', 'setRegulator', 'autoReg'],
          ['lubCooler', 'setCooling', 'lubCooler'], ['h2oCooler', 'setCooling', 'h2oCooler'],
          ['fuelFeed', 'setReactor', 'fuelFeed'], ['airIntake', 'setReactor', 'airIntake'],
          ['throttle', 'setRegulator', 'throttle'], ['targetRpm', 'setMotors', 'targetRpm']
        ];
        controls.forEach(([componentId, action, key]) => {
          if (!Object.prototype.hasOwnProperty.call(telemetry, componentId)) return;
          const value = telemetry[componentId];
          const appliedKey = '_mpAppliedComponent_' + componentId;
          if (Object.prototype.hasOwnProperty.call(this, appliedKey) && Object.is(this[appliedKey], value)) return;
          this[appliedKey] = value;
          this._cmdHandler({ action, key, value, componentId, from: 'multiplayer-server' });
        });
        // Readings, heat, condition and fault flags are also room state. Apply
        // each authoritative server revision into the local simulation without
        // emitting another control command or creating a feedback loop.
        const metricRevision = Number(telemetry.updatedAt) || 0;
        if (this._mpAppliedMetricRevision !== metricRevision) {
          this._mpAppliedMetricRevision = metricRevision;
          this._cmdHandler({ action: 'applyTelemetrySnapshot', telemetry, from: 'multiplayer-server' });
        }
        if (systems.engine && Number.isFinite(Number(systems.engine.rudder)) && this._mpAppliedRudder !== Number(systems.engine.rudder)) {
          this._mpAppliedRudder = Number(systems.engine.rudder);
          this._cmdHandler({ action: 'setRudder', value: this._mpAppliedRudder, from: 'multiplayer-server' });
        }
        this._mpHasAuthoritativeState = true;
      }

      // Normalize the flat server record into the structured UI model consumed
      // by Main Deck. Preserve metric values when an older server omits them.
      const structured = Object.assign({}, this.telemetry, {
        ts: Date.now(), connected: true, source: 'multiplayer-server'
      });
      const scalarKeys = [
        'shipSpeedKn','headingDeg','rpm','powerKw','elecPowerKw','temperatureC','fuelPercent',
        'fuelRemainingKg','loadDemandKw','voltage','current','pressureBar','torqueNm','flowLmin',
        'fuelMassFlow','omega','mechPowerKw','busPowerKw','volFlow','density','coolantLevel',
        'coolantQuality','filterDeltaP','lubCooler','h2oCooler','fuelFeed','airIntake','targetRpm'
      ];
      scalarKeys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(telemetry, key) && Number.isFinite(Number(telemetry[key]))) structured[key] = Number(telemetry[key]);
      });
      if (Object.prototype.hasOwnProperty.call(telemetry, 'throttle') && Number.isFinite(Number(telemetry.throttle))) structured.throttle = Number(telemetry.throttle);
      structured.electrics = Object.assign({}, structured.electrics || {}, {
        main: telemetry.mainPower === true, motor1: telemetry.motor1 === true,
        motor2: telemetry.motor2 === true, starter: telemetry.starter === true, aux: telemetry.aux === true
      });
      structured.cooling = Object.assign({}, structured.cooling || {}, {
        lubPump: telemetry.lubPump === true, swPump: telemetry.swPump === true,
        lubCooler: Number.isFinite(Number(telemetry.lubCooler)) ? Number(telemetry.lubCooler) : (structured.cooling && structured.cooling.lubCooler),
        h2oCooler: Number.isFinite(Number(telemetry.h2oCooler)) ? Number(telemetry.h2oCooler) : (structured.cooling && structured.cooling.h2oCooler),
        coolantLevel: Number.isFinite(Number(telemetry.coolantLevel)) ? Number(telemetry.coolantLevel) : (structured.cooling && structured.cooling.coolantLevel),
        coolantQuality: Number.isFinite(Number(telemetry.coolantQuality)) ? Number(telemetry.coolantQuality) : (structured.cooling && structured.cooling.coolantQuality),
        filterDeltaP: Number.isFinite(Number(telemetry.filterDeltaP)) ? Number(telemetry.filterDeltaP) : (structured.cooling && structured.cooling.filterDeltaP)
      });
      structured.reactor = Object.assign({}, structured.reactor || {}, {
        generator: telemetry.generator === true,
        fuelFeed: Number.isFinite(Number(telemetry.fuelFeed)) ? Number(telemetry.fuelFeed) : (structured.reactor && structured.reactor.fuelFeed),
        airIntake: Number.isFinite(Number(telemetry.airIntake)) ? Number(telemetry.airIntake) : (structured.reactor && structured.reactor.airIntake)
      });
      structured.motors = Object.assign({}, structured.motors || {}, {
        clutch: telemetry.clutch === true,
        targetRpm: Number.isFinite(Number(telemetry.targetRpm)) ? Number(telemetry.targetRpm) : (structured.motors && structured.motors.targetRpm)
      });
      structured.regulator = Object.assign({}, structured.regulator || {}, {
        autoReg: telemetry.autoReg === true,
        throttle: Number.isFinite(Number(telemetry.throttle)) ? Number(telemetry.throttle) : (structured.regulator && structured.regulator.throttle)
      });
      if (telemetry.machineHeat && typeof telemetry.machineHeat === 'object') {
        structured.machineHeat = Object.assign({}, structured.machineHeat || {}, telemetry.machineHeat);
      }
      if (['normal', 'warning', 'critical'].includes(String(telemetry.condition))) structured.condition = String(telemetry.condition);
      if (Array.isArray(telemetry.activeFaults)) structured.activeFaults = telemetry.activeFaults.slice(0, 14);
      Object.assign(this.telemetry, structured);
      this._lastRx = now();
      this._emit('telemetry', this.telemetry);
      this._emit('status', { connected: true, role: 'multiplayer-server' });
    };
    if (this._mpEnabled) {
      window.addEventListener('message', this._mpStateHandler);
      setTimeout(() => {
        const area = /engine-room\.html/i.test(location.pathname) ? 'engine-room' : (/storage\.html/i.test(location.pathname) ? 'storage' : 'main-deck');
        try {
          if (this._mpEmbedded) window.parent.postMessage({ source: 'TITAN_MAIN_DECK', type: 'AREA_CHANGE', area: area }, window.location.origin);
          else window.TitanMultiplayerRuntime?.setArea?.(area);
        } catch (e) {}
      }, 0);
    }
    this._storageHandler = this._onStorage.bind(this);

    if (!this._mpEnabled) {
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          this._bc = new BroadcastChannel(CHANNEL);
          this._bc.onmessage = (ev) => this._onMessage(ev.data);
        }
      } catch (e) {}

      try { window.addEventListener('storage', this._storageHandler); } catch (e) {}

      // Seed from the local same-origin bus only outside multiplayer rooms.
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            Object.assign(this.telemetry, parsed);
            this.telemetry.connected = (now() - (parsed.ts || 0)) < STALE_MS;
          }
        }
      } catch (e) {}
    }
  }

  TitanShipBus.prototype._emit = function (type, payload) {
    const list = this._listeners[type] || [];
    for (let i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) {}
    }
  };

  TitanShipBus.prototype.on = function (type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
    return () => {
      const arr = this._listeners[type];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  };

  TitanShipBus.prototype._onMessage = function (data) {
    if (this._mpEnabled || !data || typeof data !== 'object') return;
    if (data.type === 'telemetry' && data.payload) {
      Object.assign(this.telemetry, data.payload);
      this.telemetry.ts = data.payload.ts || now();
      this.telemetry.connected = true;
      this._lastRx = now();
      this._emit('telemetry', this.telemetry);
      this._emit('status', { connected: true, role: data.from });
    } else if (data.type === 'command' && data.payload) {
      this._emit('command', data.payload);
      if (this._cmdHandler) {
        try { this._cmdHandler(data.payload); } catch (e) {}
      }
    } else if (data.type === 'ping') {
      if (this.role === 'engine' && this._publishFn) this._publishFn(true);
    }
  };

  TitanShipBus.prototype._onStorage = function (e) {
    if (this._mpEnabled || !e) return;
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && parsed.source !== this.role) {
          Object.assign(this.telemetry, parsed);
          this.telemetry.connected = true;
          this._lastRx = now();
          this._emit('telemetry', this.telemetry);
        }
      } catch (err) {}
    }
    if (e.key === CMD_KEY && e.newValue && this.role === 'engine') {
      try {
        const cmd = JSON.parse(e.newValue);
        if (cmd && cmd.ts && (now() - cmd.ts) < 3000) {
          this._emit('command', cmd);
          if (this._cmdHandler) this._cmdHandler(cmd);
        }
      } catch (err) {}
    }
  };

  TitanShipBus.prototype.publishTelemetry = function (partial) {
    const snap = Object.assign({}, this.telemetry, partial || {}, {
      ts: now(), source: this.role, connected: true
    });
    this.telemetry = snap;

    if (!this._mpEnabled) {
      const msg = { type: 'telemetry', from: this.role, payload: snap };
      try { if (this._bc) this._bc.postMessage(msg); } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snap)); } catch (e) {}
    }
    this._emit('telemetry', snap);

    // Multiplayer telemetry carries measured/read-only values only. Switches
    // and setpoints travel as individual component commands, never as stale
    // snapshots that could overwrite a newer player's change.
    if (this._mpEnabled && this.role === 'engine') {
      const telemetry = {};
      const keys = [
        'shipSpeedKn','headingDeg','rpm','powerKw','elecPowerKw','temperatureC','fuelPercent',
        'fuelRemainingKg','loadDemandKw','voltage','current','pressureBar','torqueNm','flowLmin',
        'fuelMassFlow','omega','mechPowerKw','busPowerKw','volFlow','density'
      ];
      keys.forEach(key => { if (Number.isFinite(Number(snap[key]))) telemetry[key] = Number(snap[key]); });
      if (['normal', 'warning', 'critical'].includes(String(snap.condition))) telemetry.condition = String(snap.condition);
      if (Array.isArray(snap.activeFaults)) telemetry.activeFaults = snap.activeFaults.slice(0, 14);
      if (snap.cooling) {
        ['coolantLevel','coolantQuality','filterDeltaP'].forEach(key => {
          if (Number.isFinite(Number(snap.cooling[key]))) telemetry[key] = Number(snap.cooling[key]);
        });
      }
      if (snap.machineHeat && typeof snap.machineHeat === 'object') {
        telemetry.machineHeat = {};
        ['electrics','reactor','regulator','motors'].forEach(key => {
          if (Number.isFinite(Number(snap.machineHeat[key]))) telemetry.machineHeat[key] = Number(snap.machineHeat[key]);
        });
      }
      try {
        if (this._mpEmbedded) window.parent.postMessage({ source: 'TITAN_ENGINE_ROOM', type: 'TELEMETRY', telemetry }, window.location.origin);
        else window.TitanMultiplayerRuntime?.handleEngineTelemetry?.(telemetry);
      } catch (e) {}
    }
  };

  TitanShipBus.prototype.sendCommand = function (action, value, extra) {
    const cmd = Object.assign({
      action: action,
      value: value,
      ts: now(),
      from: this.role
    }, extra || {});
    if (!this._mpEnabled) {
      const msg = { type: 'command', from: this.role, payload: cmd };
      try { if (this._bc) this._bc.postMessage(msg); } catch (e) {}
      try { localStorage.setItem(CMD_KEY, JSON.stringify(cmd)); } catch (e) {}
    }
    // In a multiplayer iframe the parent owns the server WebSocket. Forward
    // ship control intent to it; never create a second client-side simulation.
    if (this._mpEnabled) {
      try {
        if (this._mpEmbedded) window.parent.postMessage({ source: 'TITAN_SHIP_BUS', type: 'COMMAND', payload: cmd }, window.location.origin);
        else window.TitanMultiplayerRuntime?.handleBusCommand?.(cmd);
      } catch (e) {}
    }
    return cmd;
  };

  TitanShipBus.prototype.setCommandHandler = function (fn) {
    this._cmdHandler = fn;
  };

  TitanShipBus.prototype.stopEnginePublisher = function () {
    if (this._heartbeat) clearInterval(this._heartbeat);
    this._heartbeat = null;
  };

  TitanShipBus.prototype.startEnginePublisher = function (getSnapshot, intervalMs) {
    if (this.role !== 'engine') return;
    // Re-arming after visibility changes or room restoration must not create
    // multiple telemetry intervals.
    this.stopEnginePublisher();
    this._publishFn = (force) => {
      try {
        if (this._mpEnabled && !this._mpHasAuthoritativeState) return;
        const snap = typeof getSnapshot === 'function' ? getSnapshot() : getSnapshot;
        if (snap) this.publishTelemetry(snap);
      } catch (e) {}
    };
    if (!this._mpEnabled) this._publishFn(true);
    const ms = intervalMs || HEARTBEAT_MS;
    this._heartbeat = setInterval(() => this._publishFn(false), ms);
  };

  TitanShipBus.prototype.startMainDeckReceiver = function () {
    // Periodic freshness check
    setInterval(() => {
      const age = now() - (this.telemetry.ts || 0);
      const was = this.telemetry.connected;
      this.telemetry.connected = age < STALE_MS;
      if (was !== this.telemetry.connected) {
        this._emit('status', { connected: this.telemetry.connected });
      }
    }, 500);
    // Request a fresh snapshot
    try {
      if (this._bc) this._bc.postMessage({ type: 'ping', from: this.role });
    } catch (e) {}
  };

  TitanShipBus.prototype.getTelemetry = function () {
    return this.telemetry;
  };

  TitanShipBus.prototype.destroy = function () {
    this.stopEnginePublisher();
    try { if (this._bc) this._bc.close(); } catch (e) {}
    try { window.removeEventListener('storage', this._storageHandler); } catch (e) {}
    try { if (this._mpStateHandler) window.removeEventListener('message', this._mpStateHandler); } catch (e) {}
  };

  global.TitanShipBus = TitanShipBus;
  global.createTitanShipBus = function (role) { return new TitanShipBus(role); };
})(typeof window !== 'undefined' ? window : this);
