/* TITAN Shared Settings — one same-origin settings contract for all HTML rooms. */
(function (window) {
  'use strict';
  var KEY = 'titan-shared-settings-v1';
  var defaults = {
    quality: 'MED', shadows: true, fov: 70, sensitivity: 1,
    showJoystick: true, showUseBtn: true, showLookZone: true,
    padProfile: 'standard', moveStick: 'left', lookStick: 'right', stickDeadzone: .30,
    bindings: {
      interact: null, forward: null, back: null, left: null, right: null,
      lookLeft: null, lookRight: null, lookUp: null, lookDown: null,
      menuUp: null, menuDown: null, menuLeft: null, menuRight: null,
      menuConfirm: null, fullscreen: null
    }
  };
  var bindingKeys = Object.keys(defaults.bindings);
  function finite(value, fallback, min, max) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }
  function normalize(value) {
    var v = value && typeof value === 'object' ? value : {};
    var out = Object.assign({}, defaults, v);
    out.quality = ['LOW', 'MED', 'HIGH'].indexOf(String(out.quality).toUpperCase()) >= 0 ? String(out.quality).toUpperCase() : defaults.quality;
    out.shadows = out.shadows !== false;
    out.fov = finite(out.fov, 70, 45, 100);
    out.sensitivity = finite(out.sensitivity, 1, .35, 2.5);
    out.showJoystick = out.showJoystick !== false;
    out.showUseBtn = out.showUseBtn !== false;
    out.showLookZone = out.showLookZone !== false;
    out.padProfile = ['xbox', 'playstation', 'standard', 'custom'].indexOf(out.padProfile) >= 0 ? out.padProfile : 'standard';
    out.moveStick = out.moveStick === 'right' ? 'right' : 'left';
    out.lookStick = out.lookStick === 'left' ? 'left' : 'right';
    out.stickDeadzone = finite(out.stickDeadzone, .30, .16, .5);
    var source = v.bindings && typeof v.bindings === 'object' ? v.bindings : {};
    out.bindings = {};
    bindingKeys.forEach(function (key) { out.bindings[key] = source[key] == null ? null : source[key]; });
    // Voice bindings and assistant-only configuration are deliberately excluded.
    return out;
  }
  function readLegacy() {
    var old = {};
    try {
      var q = localStorage.getItem('titan-deck-q');
      if (q) old.quality = q;
      var f = localStorage.getItem('titan-walk-fov-v1');
      if (f) old.fov = finite(f, 70, 45, 100);
      var t = JSON.parse(localStorage.getItem('titan-settings-v2') || 'null');
      if (t && typeof t === 'object') {
        ['showJoystick', 'showUseBtn', 'showLookZone', 'padProfile', 'moveStick', 'lookStick', 'stickDeadzone'].forEach(function(k) {
          if (t[k] !== undefined) old[k] = t[k];
        });
        if (t.bindings) old.bindings = t.bindings;
      }
    } catch (_) {}
    return old;
  }
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
    if (!raw) raw = readLegacy();
    var result = normalize(raw);
    try { localStorage.setItem(KEY, JSON.stringify(result)); } catch (_) {}
    return result;
  }
  var data = null;
  function current() { if (!data) data = load(); return data; }
  function save() {
    data = normalize(data || defaults);
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
    return data;
  }
  function update(patch) { data = Object.assign({}, current(), patch || {}); return save(); }
  function set(key, value) { var patch = {}; patch[key] = value; return update(patch); }
  function get(key) { return current()[key]; }
  function getControls() {
    var d = current();
    return {
      showJoystick: d.showJoystick, showUseBtn: d.showUseBtn, showLookZone: d.showLookZone,
      padProfile: d.padProfile, moveStick: d.moveStick, lookStick: d.lookStick,
      stickDeadzone: d.stickDeadzone, bindings: Object.assign({}, d.bindings)
    };
  }
  function setControls(controls) {
    var c = controls && typeof controls === 'object' ? controls : {};
    var patch = {};
    ['showJoystick', 'showUseBtn', 'showLookZone', 'padProfile', 'moveStick', 'lookStick', 'stickDeadzone'].forEach(function(k) {
      if (c[k] !== undefined) patch[k] = c[k];
    });
    if (c.bindings && typeof c.bindings === 'object') {
      var allowed = {};
      bindingKeys.forEach(function(k) { allowed[k] = c.bindings[k] == null ? null : c.bindings[k]; });
      patch.bindings = allowed;
    }
    return update(patch);
  }
  window.TitanSharedSettings = {
    KEY: KEY, defaults: defaults, load: load, save: save, get: get, set: set,
    update: update, getControls: getControls, setControls: setControls
  };
})(window);
