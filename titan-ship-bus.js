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
  };

  global.TitanShipBus = TitanShipBus;
  global.createTitanShipBus = function (role) { return new TitanShipBus(role); };
})(typeof window !== 'undefined' ? window : this);
