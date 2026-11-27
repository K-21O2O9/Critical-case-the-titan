/* TITAN Direct Main Deck Multiplayer Entry
 * Keeps direct Main Deck navigation attached to the same authoritative room.
 * The page never invents local multiplayer players: only server-joined sessions
 * are displayed, moved and reconnected.
 */
(function (window, document) {
  'use strict';
  if (window.__TITAN_MP_DECK_RUNTIME__) return;
  window.__TITAN_MP_DECK_RUNTIME__ = true;

  var DEFAULT_SERVER = 'wss://titan-multiplayer.onrender.com';
  var SESSION_KEY = 'titan-mp-active-session';
  var DEVICE_KEY = 'titan-mp-device-id';
  var CHARACTER_KEY = 'titan-character-v1';
  var params = new URLSearchParams(window.location.search);
  var embeddedRoomPage = params.get('multiplayer') === '1' && window.parent !== window;
  if (embeddedRoomPage) {
    window.TitanMultiplayerRuntime = { active: false, embedded: true, connected: false };
    return;
  }
  var queryRoomCode = String(params.get('room') || params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  var socket = null;
  var session = null;
  var roomState = null;
  var playerId = '';
  var reconnectTimer = null;
  var reconnectDelay = 1200;
  var joined = false;
  var leaving = false;
  var gate = null;
  var statusNode = null;
  var mapView = null;
  var remoteActors = new Map();
  var lastPoseSent = 0;
  var lastPose = null;
  var lastPoseArea = null;
  var animationClock = 0;
  var enterTriggered = false;

  function safeJson(raw) { try { return JSON.parse(raw || 'null'); } catch (_) { return null; } }
  function readStartupSession() {
    try { return safeJson(localStorage.getItem(SESSION_KEY)); } catch (_) { return null; }
  }
  var startupSession = readStartupSession();
  var directEntryRequested = !!queryRoomCode || params.get('multiplayer') === 'join' || !!(startupSession && startupSession.code && startupSession.team && startupSession.deviceId);
  if (!directEntryRequested) {
    window.TitanMultiplayerRuntime = { active: false, connected: false, awaitingJoin: false };
    return;
  }
  var playerArea = /engine-room\.html$/i.test(window.location.pathname) ? 'engine-room' : (/storage\.html$/i.test(window.location.pathname) ? 'storage' : 'main-deck');
  var lastHeartbeatAt = 0;
  function getDeviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('deck-' + Date.now() + '-' + Math.random().toString(16).slice(2));
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (_) { return 'deck-' + Math.random().toString(16).slice(2); }
  }
  function defaultCharacter(name) {
    var cfg = window.TitanCharacterRuntime ? window.TitanCharacterRuntime.readCharacter() : {
      name: name || 'Crew Member', skinColor: '#d9a47f', outfitColor: '#2b8990', accentColor: '#e2bd78',
      hairColor: '#28333b', eyeColor: '#26333a', hairStyle: 'short', accessory: 'none', height: 1, bodyBuild: 1, animationSpeed: 1
    };
    cfg.name = String(name || cfg.name || 'Crew Member').replace(/[<>]/g, '').slice(0, 24) || 'Crew Member';
    if (window.TitanCharacterRuntime) window.TitanCharacterRuntime.saveCharacter(cfg);
    else { try { localStorage.setItem(CHARACTER_KEY, JSON.stringify(cfg)); } catch (_) {} }
    return cfg;
  }
  // Main Deck's own entry guard runs immediately after this file. Seed a safe
  // default profile so a direct multiplayer room join never gets redirected
  // to character creation before its room connection can be established.
  try { if (!localStorage.getItem(CHARACTER_KEY)) defaultCharacter('Crew Member'); } catch (_) {}
  function normalizeServer(value) {
    var u = new URL(value || DEFAULT_SERVER, window.location.href);
    if (u.protocol === 'https:') u.protocol = 'wss:';
    if (u.protocol === 'http:') u.protocol = 'ws:';
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new Error('Server address must be ws:// or wss://.');
    u.hash = '';
    return u.toString();
  }
  function storeSession(next) {
    session = next;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch (_) {}
    try { localStorage.setItem('titan-mp-server', next.server); } catch (_) {}
  }
  function clearStoredSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }
  function setStatus(message, error) {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.style.color = error ? '#ffb1a9' : '#a9e3dc';
  }
  function clearRemoteActors() {
    remoteActors.forEach(removeActor);
    remoteActors.clear();
  }
  function makeGate() {
    if (gate) return;
    var style = document.createElement('style');
    style.textContent = `
      #titan-mp-gate{position:fixed;inset:0;z-index:100000;background:rgba(2,10,17,.86);backdrop-filter:blur(12px);display:grid;place-items:center;padding:18px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;touch-action:auto}
      #titan-mp-gate .mp-card{width:min(440px,100%);padding:22px;border:1px solid #326477;border-radius:18px;background:linear-gradient(150deg,#0b2839,#061725);box-shadow:0 24px 90px #000a;color:#effafa}
      #titan-mp-gate h2{margin:0 0 6px;font-size:19px;letter-spacing:.08em}
      #titan-mp-gate p{margin:0 0 14px;color:#a7c2cc;font-size:12px;line-height:1.5}
      #titan-mp-gate label{display:grid;gap:6px;margin:10px 0;color:#c5dce4;font-size:11px}
      #titan-mp-gate input,#titan-mp-gate select{width:100%;min-height:44px;border:1px solid #355e70;border-radius:9px;background:#03141f;color:white;padding:10px;font:inherit}
      #titan-mp-gate .mp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}
      #titan-mp-gate button{flex:1;min-height:44px;border-radius:9px;padding:10px 12px;border:1px solid #3b7583;background:#125567;color:white;font-weight:750;font-size:11px;letter-spacing:.04em}
      #titan-mp-gate button.secondary{background:#102636;border-color:#345264;color:#bdd0d7}
      #titan-mp-status{min-height:18px;margin-top:12px;font-size:11px;line-height:1.4}
      #titan-mp-hud{position:fixed;left:12px;top:max(10px,env(safe-area-inset-top));z-index:1000;display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #366273;border-radius:10px;background:#041722e8;color:#d8f4f2;font:10px ui-monospace,monospace;box-shadow:0 4px 16px #0005;pointer-events:auto}
      #titan-mp-hud button{border:1px solid #456b7a;background:#102c3b;color:#e8f8fa;border-radius:6px;padding:4px 7px;font:inherit}
      @media(max-width:500px){#titan-mp-gate .mp-card{padding:18px}#titan-mp-hud{font-size:9px}}
    `;
    document.head.appendChild(style);
    gate = document.createElement('div');
    gate.id = 'titan-mp-gate';
    var queryCode = String(params.get('room') || params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    var queryTeam = params.get('team') === 'B' ? 'B' : (params.get('team') === 'A' ? 'A' : '');
    var savedServer = '';
    try { savedServer = localStorage.getItem('titan-mp-server') || ''; } catch (_) {}
    gate.innerHTML = `
      <div class="mp-card" role="dialog" aria-modal="true" aria-labelledby="titan-mp-title">
        <h2 id="titan-mp-title">JOIN THE SHARED TITAN WORLD</h2>
        <p>Enter the room code from the host. Direct Main Deck entry still joins the same server room, ship and crew as everyone else.</p>
        <label>Room code<input id="titan-mp-code" maxlength="8" autocomplete="off" placeholder="HOST ROOM CODE" value="${queryCode}"></label>
        <label>Your crew name<input id="titan-mp-name" maxlength="22" autocomplete="nickname" placeholder="Crew member"></label>
        <label>Assigned ship<select id="titan-mp-team"><option value="">Choose your ship</option><option value="A">Ship A · Alpha</option><option value="B">Ship B · Bravo</option></select></label>
        <label>Multiplayer server<input id="titan-mp-server" value="${savedServer || DEFAULT_SERVER}" autocomplete="url"></label>
        <div class="mp-actions"><button id="titan-mp-join">JOIN ROOM & BOARD</button><button class="secondary" id="titan-mp-solo">CONTINUE OFFLINE</button></div>
        <div id="titan-mp-status" role="status" aria-live="polite">${queryCode ? 'Room code loaded. Choose your ship and join.' : 'A room code is required to play with other people.'}</div>
      </div>`;
    document.body.appendChild(gate);
    statusNode = document.getElementById('titan-mp-status');
    document.getElementById('titan-mp-team').value = queryTeam;
    document.getElementById('titan-mp-name').value = params.get('name') || (safeJson(readStoredCharacter()) || {}).name || '';
    document.getElementById('titan-mp-code').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); });
    document.getElementById('titan-mp-join').addEventListener('click', submitJoin);
    document.getElementById('titan-mp-solo').addEventListener('click', function () {
      leaving = true;
      if (socket && socket.readyState === WebSocket.OPEN) socket.close();
      socket = null; joined = false; clearStoredSession();
      // Drop the room query and reload so the regular Main Deck initializes with
      // its normal offline ship-bus and chart-map paths.
      try { window.location.replace('main-deck.html'); } catch (_) { window.location.href = 'main-deck.html'; }
    });
  }
  function readStoredCharacter() {
    try { return localStorage.getItem(CHARACTER_KEY); } catch (_) { return null; }
  }
  function showHud(text) {
    var node = document.getElementById('titan-mp-hud');
    if (!node) {
      node = document.createElement('div'); node.id = 'titan-mp-hud'; document.body.appendChild(node);
    }
    node.innerHTML = '<span></span><button type="button">LEAVE ROOM</button>';
    node.firstElementChild.textContent = text;
    node.lastElementChild.addEventListener('click', function () {
      leaving = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'player:leave' })); } catch (_) {}
        socket.close();
      }
      socket = null; joined = false; roomState = null; playerId = ''; clearStoredSession(); clearRemoteActors();
      node.remove();
      makeGate(); setStatus('You left the multiplayer room. Enter another code to join a shared session.');
    });
  }
  function makeSessionFromForm() {
    var code = document.getElementById('titan-mp-code').value.trim().toUpperCase();
    var name = document.getElementById('titan-mp-name').value.trim().slice(0, 22);
    var team = document.getElementById('titan-mp-team').value;
    var server = normalizeServer(document.getElementById('titan-mp-server').value.trim());
    if (code.length < 6) throw new Error('Enter the room code supplied by the host.');
    if (!name) throw new Error('Enter a crew name.');
    if (team !== 'A' && team !== 'B') throw new Error('Choose Ship A or Ship B.');
    return { code: code, name: name, team: team, server: server, deviceId: getDeviceId() };
  }
  function connectAndJoin(next) {
    storeSession(next);
    setStatus('Connecting to the room server…');
    try { localStorage.setItem('titan-mp-server', next.server); } catch (_) {}
    socket = new WebSocket(next.server);
    var current = socket;
    var timeout = setTimeout(function () {
      if (current === socket && current.readyState !== WebSocket.OPEN) {
        setStatus('Connection timed out. Check the server address and Render deployment.', true);
        try { current.close(); } catch (_) {}
      }
    }, 12000);
    current.onopen = function () {
      clearTimeout(timeout);
      var character = defaultCharacter(next.name);
      current.send(JSON.stringify({ type: 'join', code: next.code, team: next.team, name: next.name, deviceId: next.deviceId, character: character, area: playerArea }));
      setStatus('Joining Room ' + next.code + ' · Ship ' + next.team + '…');
    };
    current.onerror = function () { if (current === socket) setStatus('Could not connect. Check your internet and the multiplayer server.', true); };
    current.onmessage = function (event) {
      var msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      onServerMessage(msg, current);
    };
    current.onclose = function () {
      clearTimeout(timeout);
      if (current !== socket || leaving) return;
      socket = null;
      if (joined && session) scheduleReconnect();
      else setStatus('Connection closed. Check the room code and try again.', true);
    };
  }
  function submitJoin() {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) socket.close();
      var next = makeSessionFromForm();
      leaving = false; joined = false; reconnectDelay = 1200;
      connectAndJoin(next);
    } catch (err) { setStatus(err.message || 'Unable to join this room.', true); }
  }
  function scheduleReconnect() {
    if (reconnectTimer || !session || leaving) return;
    setStatus('Connection lost · reconnecting to Room ' + session.code + '…');
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (!session || leaving) return;
      reconnectDelay = Math.min(10000, reconnectDelay * 1.7);
      try { connectAndJoin(session); } catch (_) { scheduleReconnect(); }
    }, reconnectDelay);
  }
  function onServerMessage(msg, sourceSocket) {
    if (sourceSocket !== socket) return;
    if (msg.type === 'error') {
      if (!gate) makeGate();
      if (session) {
        document.getElementById('titan-mp-code').value = session.code || '';
        document.getElementById('titan-mp-name').value = session.name || '';
        document.getElementById('titan-mp-team').value = session.team || '';
        document.getElementById('titan-mp-server').value = session.server || DEFAULT_SERVER;
      }
      setStatus(msg.message || 'The server rejected this join.', true);
      return;
    }
    if (msg.type === 'joined') {
      joined = true;
      playerId = msg.playerId || session.deviceId;
      session.playerId = playerId;
      session.team = msg.team || session.team;
      storeSession(session);
      reconnectDelay = 1200;
      roomState = msg.state || roomState;
      if (gate) { gate.remove(); gate = null; }
      showHud('ROOM ' + session.code + ' · SHIP ' + session.team + ' · CONNECTED');
      setStatus('Connected to the shared room.');
      if (roomState) {
        applyRoomState(roomState);
        var self = (roomState.players || []).find(function (p) { return p.id === playerId; });
        if (self && self.area) playerArea = self.area;
        if (roomState.status === 'lobby') send('player:ready', { ready: true });
      }
      // Main Deck auto-starts locally. This click is safe and idempotent.
      if (!enterTriggered) {
        enterTriggered = true;
        var start = document.getElementById('btn-start');
        if (start) start.click();
      }
      return;
    }
    if (msg.type === 'state') {
      roomState = msg.state || roomState;
      if (roomState) applyRoomState(roomState);
      return;
    }
    if (msg.type === 'kicked' || msg.type === 'left') {
      joined = false; clearStoredSession(); session = null; roomState = null; clearRemoteActors();
      showHud(msg.message || 'You left the room.');
    }
  }
  function send(type, payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify(Object.assign({ type: type }, payload || {}))); return true; } catch (_) {}
    }
    return false;
  }
  function getDeck() {
    var game = window.TitanDeckGame;
    if (!game) return null;
    try {
      var scene = game.scene, ship = game.ship;
      return scene && ship ? { scene: scene, ship: ship } : null;
    } catch (_) { return null; }
  }
  function currentPosePayload() {
    if (playerArea === 'main-deck' && window.TitanDeckGame && typeof window.TitanDeckGame.getPose === 'function') {
      var deckPose = window.TitanDeckGame.getPose();
      return { x: deckPose.x, z: deckPose.z, yaw: deckPose.yaw, area: 'main-deck', moving: false };
    }
    return lastPose && lastPoseArea === playerArea ? { x: lastPose.x, z: lastPose.z, yaw: lastPose.yaw, area: playerArea, moving: false } : null;
  }
  function withCurrentPose(payload) {
    var pose = currentPosePayload();
    if (pose) payload.pose = pose;
    return payload;
  }
  function removeActor(actor) {
    if (!actor) return;
    if (actor.anchor && actor.anchor.parent) actor.anchor.parent.remove(actor.anchor);
    if (actor.model) actor.model.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(function (mat) { mat.dispose(); });
    });
  }
  function updateRemotePlayers() {
    var deck = getDeck();
    if (!deck || !roomState || !session) return;
    // When main-deck.html provides its own setMultiplayerState / remote actor system,
    // do not create a second set of remote player models (avoids duplicates / hidden players).
    if (window.TitanDeckGame && typeof window.TitanDeckGame.setMultiplayerState === 'function') {
      clearRemoteActors();
      return;
    }
    var live = new Set();
    (roomState.players || []).filter(function (p) {
      return p.connected && p.id !== playerId && p.team === session.team && (p.area || 'main-deck') === 'main-deck';
    }).forEach(function (p) {
      live.add(p.id);
      var actor = remoteActors.get(p.id);
      if (!actor) {
        var model = window.TitanCharacterRuntime && window.TitanCharacterRuntime.createModel(window.THREE, p.character || { name: p.name }, { scale: 0.78 });
        if (!model) return;
        var anchor = new window.THREE.Group();
        anchor.name = 'TITAN_REMOTE_PLAYER_' + p.id;
        anchor.add(model);
        deck.ship.add(anchor);
        actor = { anchor: anchor, model: model, target: new window.THREE.Vector3(), moving: false, running: false, speed: Number(p.character && p.character.animationSpeed) || 1 };
        remoteActors.set(p.id, actor);
      }
      actor.target.set(Number(p.x) || 0, 3.2, Number(p.z) || 0);
      actor.anchor.rotation.y = Number(p.yaw) || 0;
      actor.moving = Date.now() < (p.movingUntil || 0);
      actor.running = actor.moving && !!p.running;
    });
    remoteActors.forEach(function (actor, id) {
      if (!live.has(id)) { removeActor(actor); remoteActors.delete(id); }
    });
  }
  function applyRoomState(state) {
    if (!state || !session) return;
    var packet = { state: state, playerId: playerId, role: 'player' };
    if (window.TitanDeckGame && typeof window.TitanDeckGame.setMultiplayerState === 'function') {
      window.TitanDeckGame.setMultiplayerState(packet);
    }
    try { window.postMessage({ source: 'TITAN_MULTIPLAYER', type: 'STATE', packet: packet }, window.location.origin); } catch (_) {}
    var self = (state.players || []).find(function (p) { return p.id === playerId; });
    if (self) {
      session.team = self.team;
      if (self.area) playerArea = self.area;
      // The Main Deck owns its locally predicted pose after the one-time join
      // seed. Never pull it toward an old server snapshot here; position updates
      // are sent separately and interactions include their current pose.
    }
    updateRemotePlayers();
    var hud = document.getElementById('titan-mp-hud');
    if (hud && self) hud.firstElementChild.textContent = 'ROOM ' + session.code + ' · SHIP ' + session.team + ' · ' + String(state.status || 'LOBBY').toUpperCase();
  }
  function setArea(area, sourcePose) {
    if (['main-deck', 'engine-room', 'storage'].indexOf(area) === -1) return;
    var previousArea = playerArea;
    // Snapshot source-area coordinates before changing membership. Destination
    // coordinates are restored by the server from this player's area pose.
    var deckPose = sourcePose || (previousArea === 'main-deck' && window.TitanDeckGame && typeof window.TitanDeckGame.getPose === 'function'
      ? window.TitanDeckGame.getPose() : null);
    if (deckPose && Number.isFinite(Number(deckPose.x)) && Number.isFinite(Number(deckPose.z))) {
      lastPose = { x: Number(deckPose.x), z: Number(deckPose.z), yaw: Number(deckPose.yaw) || 0 };
      lastPoseArea = previousArea;
    }
    if (joined && previousArea !== area && socket && socket.readyState === WebSocket.OPEN) {
      var pose = lastPose && lastPoseArea === previousArea
        ? { x: lastPose.x, z: lastPose.z, yaw: lastPose.yaw, area: previousArea, moving: false } : null;
      send('player:area', { area: area, pose: pose });
    }
    playerArea = area;
    lastPoseSent = 0;
  }
  function setPose(x, z, yaw, area, moving, running) {
    if (area) playerArea = area;
    lastPose = { x: Number(x) || 0, z: Number(z) || 0, yaw: Number(yaw) || 0 };
    lastPoseArea = playerArea;
    var now = performance.now();
    if (joined && socket && socket.readyState === WebSocket.OPEN && now - lastPoseSent > 70) {
      lastPoseSent = now;
      send('player:move', {
        x: lastPose.x, z: lastPose.z, yaw: lastPose.yaw,
        area: playerArea, moving: !!moving, running: !!running
      });
    }
  }

  function tick() {
    animationClock += 0.05;
    if (joined && session && socket && socket.readyState === WebSocket.OPEN) {
      var game = window.TitanDeckGame;
      var now = performance.now();
      if (game && typeof game.getPose === 'function' && playerArea === 'main-deck') {
        var pose = game.getPose();
        var changed = !lastPose || Math.hypot(pose.x - lastPose.x, pose.z - lastPose.z) > 0.025 || Math.abs(pose.yaw - lastPose.yaw) > 0.015;
        if ((changed && now - lastPoseSent > 80) || now - lastPoseSent > 1000) {
          setPose(pose.x, pose.z, pose.yaw, playerArea,
            pose.moving == null ? changed : !!pose.moving, !!pose.running);
        }
      } else if (lastPose && lastPoseArea === playerArea && now - lastHeartbeatAt > 1000) {
        // Do not invent a spawn pose while another deck/page is still loading.
        lastHeartbeatAt = now;
        send('player:move', { x: lastPose.x, z: lastPose.z, yaw: lastPose.yaw, area: playerArea, moving: false });
      }
    }
    var deck = getDeck();
    if (deck) {
      remoteActors.forEach(function (actor) {
        actor.anchor.position.lerp(actor.target, 0.34);
        if (window.TitanCharacterRuntime) window.TitanCharacterRuntime.animateModel(actor.model, animationClock, actor.moving ? 1 : 0, actor.speed * (actor.running ? 1.32 : 1));
      });
    }
    setTimeout(tick, 50);
  }

  function startWithSession(saved) {
    session = saved;
    if (!session || !session.code || !session.team || !session.deviceId) return false;
    try {
      makeGate();
      document.getElementById('titan-mp-code').value = session.code;
      document.getElementById('titan-mp-name').value = session.name || '';
      document.getElementById('titan-mp-team').value = session.team;
      document.getElementById('titan-mp-server').value = session.server || DEFAULT_SERVER;
      setStatus('Reconnecting to your saved shared room…');
      session.server = normalizeServer(session.server || DEFAULT_SERVER);
      storeSession(session);
      leaving = false;
      if (socket) { try { socket.close(); } catch (_) {} }
      connectAndJoin(session);
      return true;
    } catch (err) {
      makeGate(); setStatus(err.message || 'Saved room details are invalid.', true); return false;
    }
  }

  function handleDeckMessage(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'POSE') {
      var pose = payload.pose;
      if (!pose || !Number.isFinite(Number(pose.x)) || !Number.isFinite(Number(pose.z))) return;
      // Direct-entry Main Deck publishes its exact local pose. Forward it
      // immediately instead of depending solely on the secondary polling loop.
      setPose(pose.x, pose.z, pose.yaw, pose.area || 'main-deck', pose.moving, pose.running);
      return;
    }
    if (payload.type === 'DECK_READY') return;
    if (payload.type === 'AREA_CHANGE') { setArea(payload.area, payload.pose); return; }
    if (payload.type === 'INTERACTION') {
      var pose = payload.pose || currentPosePayload();
      if (payload.action === 'doorOpen' || payload.action === 'hatchOpen') {
        send('ship:system', { action: payload.action, value: !!payload.value, pose: pose });
      } else {
        send('ship:interaction', { target: payload.target, value: payload.value, pose: pose });
      }
    }
  }
  function handleBusCommand(cmd) {
    if (!cmd || !cmd.action) return;
    var action = String(cmd.action).toLowerCase();
    var ship = roomState && roomState.ships && roomState.ships[session && session.team || 'A'] || {};
    var throttle = Number(ship.throttle) || 0;
    var rudder = Number(ship.rudder) || 0;
    if (action === 'setthrottle') throttle = Math.max(0, Math.min(100, Number(cmd.value) || 0));
    else if (action === 'setrudder') rudder = Math.max(-35, Math.min(35, Number(cmd.value) || 0));
    else if (action === 'allstop') { throttle = 0; rudder = 0; }
    if (['setthrottle', 'setrudder', 'allstop'].includes(action)) { send('ship:control', withCurrentPose({ throttle: throttle, rudder: rudder })); return; }
    var systemAction = null;
    if (action === 'setelectrics' && String(cmd.key) === 'main') systemAction = 'powerOnline';
    else if (action === 'setcooling' && ['swPump', 'lubPump'].includes(String(cmd.key))) systemAction = 'coolingOnline';
    else if (action === 'setreactor' && String(cmd.key) === 'generator') systemAction = 'reactorOnline';
    if (systemAction) send('ship:system', withCurrentPose({ action: systemAction, value: !!cmd.value }));
  }
  function handleEngineTelemetry(telemetry) { send('ship:telemetry', withCurrentPose({ telemetry: telemetry || {} })); }

  window.TitanMultiplayerRuntime = {
    get active() { return directEntryRequested; },
    get awaitingJoin() { return !!gate; },
    get connected() { return joined && !!socket && socket.readyState === WebSocket.OPEN; },
    get state() { return roomState; },
    get session() { return session; },
    get playerId() { return playerId; },
    get area() { return playerArea; },
    send: send,
    setArea: setArea,
    setPose: setPose,
    handleDeckMessage: handleDeckMessage,
    handleBusCommand: handleBusCommand,
    handleEngineTelemetry: handleEngineTelemetry,
    leave: function () { var hud = document.getElementById('titan-mp-hud'); if (hud) hud.lastElementChild.click(); }
  };

  var stored = startupSession;
  var queryCode = queryRoomCode;
  var queryTeam = params.get('team') === 'B' ? 'B' : (params.get('team') === 'A' ? 'A' : '');
  var savedMatchesRoom = !!(queryCode && stored && String(stored.code || '').toUpperCase() === queryCode);
  if (savedMatchesRoom && stored && !params.get('new')) {
    startWithSession(stored);
  } else if (!queryCode && stored && stored.code && stored.team && stored.deviceId) {
    startWithSession(stored);
  } else {
    makeGate();
    if (stored && !queryCode) {
      document.getElementById('titan-mp-code').value = stored.code || '';
      document.getElementById('titan-mp-name').value = stored.name || '';
      document.getElementById('titan-mp-team').value = stored.team || '';
      document.getElementById('titan-mp-server').value = stored.server || DEFAULT_SERVER;
    }
    // A direct invite containing both room and team is a one-step join. A link
    // with only ?room=CODE keeps the gate open so the player can choose a ship.
    if (queryCode && queryTeam && params.get('autojoin') !== '0') {
      setStatus('Room and ship supplied by invite · joining the shared room…');
      setTimeout(function () { try { submitJoin(); } catch (_) {} }, 0);
    }
  }
  setTimeout(tick, 50);
  window.addEventListener('beforeunload', function () {
    // Do not send player:leave on refresh: reconnect must reclaim this same room identity.
    if (socket) { try { socket.onclose = null; socket.close(); } catch (_) {} }
  });
})(window, document);
