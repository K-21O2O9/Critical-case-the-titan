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
    loadDemandKw: 0,
    condition: 'normal',
    voltage: 0,
    current: 0,
    pressureBar: 1.0,
    torqueNm: 0,
    electrics: { main: false, motor1: false, motor2: false, starter: false, aux: false },
    cooling: { lubPump: false, swPump: false, coolantLevel: 100, coolantQuality: 100 },
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
    this._mpStateHandler = (ev) => {
      if (!this._mpEnabled || ev.origin !== window.location.origin || !ev.data || ev.data.source !== 'TITAN_MULTIPLAYER' || ev.data.type !== 'STATE') return;
      const ship = ev.data.packet && ev.data.packet.state && ev.data.packet.state.ships && ev.data.packet.state.ships[this._mpTeam];
      const systems = ship && ship.systems;
      // Engine Room pages consume server-owned bridge orders. Only the command
      // handler is invoked; it updates the local plant model without echoing a
      // second command back to the room.
      if (this.role === 'engine' && systems && this._cmdHandler) {
        const engine = systems.engine || {};
        if (Number.isFinite(Number(engine.throttle)) && this._mpAppliedThrottle !== Number(engine.throttle)) {
          this._mpAppliedThrottle = Number(engine.throttle);
          this._cmdHandler({ action: 'setThrottle', value: this._mpAppliedThrottle, from: 'multiplayer-server' });
        }
        if (Number.isFinite(Number(engine.rudder)) && this._mpAppliedRudder !== Number(engine.rudder)) {
          this._mpAppliedRudder = Number(engine.rudder);
          this._cmdHandler({ action: 'setRudder', value: this._mpAppliedRudder, from: 'multiplayer-server' });
        }
        if (systems.power && typeof systems.power.online === 'boolean' && this._mpAppliedPower !== systems.power.online) {
          this._mpAppliedPower = systems.power.online;
          this._cmdHandler({ action: 'setElectrics', key: 'main', value: this._mpAppliedPower, from: 'multiplayer-server' });
        }
        if (systems.cooling && typeof systems.cooling.online === 'boolean' && this._mpAppliedCooling !== systems.cooling.online) {
          this._mpAppliedCooling = systems.cooling.online;
          this._cmdHandler({ action: 'setCooling', key: 'swPump', value: this._mpAppliedCooling, from: 'multiplayer-server' });
          this._cmdHandler({ action: 'setCooling', key: 'lubPump', value: this._mpAppliedCooling, from: 'multiplayer-server' });
        }
        if (systems.reactor && typeof systems.reactor.online === 'boolean' && this._mpAppliedReactor !== systems.reactor.online) {
          this._mpAppliedReactor = systems.reactor.online;
          this._cmdHandler({ action: 'setReactor', key: 'generator', value: this._mpAppliedReactor, from: 'multiplayer-server' });
        }
      }
      const telemetry = systems && systems.telemetry;
      if (telemetry && typeof telemetry === 'object') {
        Object.assign(this.telemetry, telemetry, { ts: Date.now(), connected: true, source: 'multiplayer-server' });
        this._emit('telemetry', this.telemetry); this._emit('status', { connected: true, role: 'multiplayer-server' });
      }
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

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this._bc = new BroadcastChannel(CHANNEL);
        this._bc.onmessage = (ev) => this._onMessage(ev.data);
      }
    } catch (e) {}

    try {
      window.addEventListener('storage', this._storageHandler);
    } catch (e) {}

    // Seed from last known telemetry
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
    if (!data || typeof data !== 'object') return;
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
    if (!e) return;
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
      ts: now(),
      source: this.role,
      connected: true
    });
    this.telemetry = snap;
    const msg = { type: 'telemetry', from: this.role, payload: snap };
    try {
      if (this._bc) this._bc.postMessage(msg);
    } catch (e) {}
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (e) {}
    this._emit('telemetry', snap);
    if (this._mpEnabled && this.role === 'engine') {
      const telemetry = { shipSpeedKn: snap.shipSpeedKn, headingDeg: snap.headingDeg, rpm: snap.rpm, powerKw: snap.powerKw, elecPowerKw: snap.elecPowerKw, temperatureC: snap.temperatureC, fuelPercent: snap.fuelPercent, loadDemandKw: snap.loadDemandKw, mainPower: !!(snap.electrics && snap.electrics.main), motor1: !!(snap.electrics && snap.electrics.motor1), motor2: !!(snap.electrics && snap.electrics.motor2), generator: !!(snap.reactor && snap.reactor.generator), clutch: !!(snap.motors && snap.motors.clutch), lubPump: !!(snap.cooling && snap.cooling.lubPump), swPump: !!(snap.cooling && snap.cooling.swPump) };
      try {
        if (this._mpEmbedded) window.parent.postMessage({ source: 'TITAN_ENGINE_ROOM', type: 'TELEMETRY', telemetry: telemetry }, window.location.origin);
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
    const msg = { type: 'command', from: this.role, payload: cmd };
    try {
      if (this._bc) this._bc.postMessage(msg);
    } catch (e) {}
    // localStorage fallback for same-origin tabs that miss BC
    try {
      localStorage.setItem(CMD_KEY, JSON.stringify(cmd));
      // Force storage event in same tab for engine if needed
      if (this.role !== 'engine' && this._cmdHandler) {
        // main deck does not handle its own cmds
      }
    } catch (e) {}
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

  TitanShipBus.prototype.startEnginePublisher = function (getSnapshot, intervalMs) {
    if (this.role !== 'engine') return;
    this._publishFn = (force) => {
      try {
        const snap = typeof getSnapshot === 'function' ? getSnapshot() : getSnapshot;
        if (snap) this.publishTelemetry(snap);
      } catch (e) {}
    };
    this._publishFn(true);
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
    if (this._heartbeat) clearInterval(this._heartbeat);
    try { if (this._bc) this._bc.close(); } catch (e) {}
    try { window.removeEventListener('storage', this._storageHandler); } catch (e) {}
    try { if (this._mpStateHandler) window.removeEventListener('message', this._mpStateHandler); } catch (e) {}
  };

  global.TitanShipBus = TitanShipBus;
  global.createTitanShipBus = function (role) { return new TitanShipBus(role); };
})(typeof window !== 'undefined' ? window : this);
