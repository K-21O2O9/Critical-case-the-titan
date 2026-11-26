/**
 * VoiceCore — Main engine
 * Orchestrates microphone, registry, execution and responses.
 *
 * Usage:
 *   await VoiceCore.init({ container: '#voice-ui' });
 *   VoiceCore.register({ name: '...', phrases: [...], action: () => {}, response: '...' });
 *   VoiceCore.start();
 */
(function (global) {
  "use strict";

  const VoiceCore = global.VoiceCore || (global.VoiceCore = {});

  // Re-export submodules for convenience
  // (they attach themselves to VoiceCore)

  Object.assign(VoiceCore, {
    version: "2.2.0",
    orbMode: true,          // collapsed AI blob by default
    expanded: false,
    dormant: true,          // only wake words accepted until activated
    _wakeRestartTimer: null,
    ready: false,
    listening: false,
    lastPartial: "",
    lastFinal: "",
    lastResult: null,

    // DOM elements (created if missing)
    ui: {
      root: null,
      btn: null,
      status: null,
      transcript: null,
      history: null,
      response: null
    },

    /**
     * Initialise the engine and optional UI.
     * @param {Object} [opts]
     * @param {string|HTMLElement} [opts.container]  Where to inject the floating UI
     * @param {boolean} [opts.autoUI=true]           Create the default control panel
     * @param {string}  [opts.lang='en-US']
     */
    async init(opts = {}) {
      const Settings = VoiceCore.Settings;
      const Mic = VoiceCore.Microphone;
      const Response = VoiceCore.VoiceResponse;
      const Exec = VoiceCore.ExecutionEngine;

      Settings.load();
      Response.init();
      Response.setEnabled(Settings.get("voiceFeedback"));

      const ok = Mic.init({
        lang: opts.lang || Settings.get("lang") || "en-US",
        continuous: Settings.get("continuous") !== false,
        interimResults: true
      });

      if (!ok) {
        console.warn("[VoiceCore] Speech recognition not available. Commands can still be triggered programmatically.");
      }

      Mic.onPartial = (text) => {
        VoiceCore.lastPartial = text;
        VoiceCore._updateUI({ partial: text });
      };

      Mic.onFinal = async (text, alternatives) => {
        VoiceCore.lastFinal = text;
        VoiceCore._updateUI({ final: text, partial: "" });
        const payload = (alternatives && alternatives.length) ? alternatives : text;
        const primary = Array.isArray(payload) ? (payload[0] || text) : text;

        // --- Dormant: only accept wake words ---
        if (VoiceCore.dormant) {
          if (VoiceCore._isWakePhrase(primary, alternatives)) {
            VoiceCore.activate({ silent: false });
            // If the utterance also contained a command after the wake word, try it
            const stripped = VoiceCore._stripWake(primary);
            if (stripped && stripped.length > 2) {
              const result = await Exec.process(stripped);
              VoiceCore.lastResult = result;
              VoiceCore._updateUI({ result });
              if (result && result.ok && result.command &&
                  result.command.name !== "brave_activate" &&
                  result.command.name !== "brave_disengage") {
                VoiceCore._sleepAfterCommand();
              }
            }
          }
          // Ignore everything else while dormant
          return;
        }

        // --- Awaiting yes/no for automatic fix ---
        if (VoiceCore._awaitingFixReply) {
          const t = String(primary || "").toLowerCase().trim();
          const yes = /^(yes|yeah|yep|sure|ok|okay|affirmative|do it|fix it|please|go ahead)\b/.test(t) ||
                      /\b(yes|fix it|go ahead|do it)\b/.test(t);
          const no = /^(no|nope|nah|cancel|stop|don't|do not)\b/.test(t) || /\b(no thanks|negative)\b/.test(t);
          if (yes) {
            VoiceCore._awaitingFixReply = false;
            const r = await Exec.process("fix crisis");
            VoiceCore.lastResult = r;
            VoiceCore._updateUI({ result: r });
            if (VoiceCore.speak) VoiceCore.speak("Understood. Stabilising systems now.");
            VoiceCore._sleepAfterCommand({ collapse: true });
            return;
          }
          if (no) {
            VoiceCore._awaitingFixReply = false;
            if (VoiceCore.speak) VoiceCore.speak("Okay. I will not intervene.");
            VoiceCore._sleepAfterCommand({ collapse: true });
            return;
          }
          // Unclear — stay waiting, still allow other commands to fall through
        }

        // --- Active: full command processing ---
        const result = await Exec.process(payload);
        VoiceCore.lastResult = result;
        VoiceCore._updateUI({ result });

        // After a successful real command → mic off + sleep
        if (result && result.ok && result.command) {
          const n = result.command.name;
          if (n === "brave_activate") {
            // stay active
          } else if (n === "brave_disengage") {
            VoiceCore._sleepAfterCommand({ collapse: true });
          } else {
            VoiceCore._sleepAfterCommand({ collapse: true });
          }
        }
      };

      Mic.onError = (err) => {
        // Friendlier status for common Web Speech failures
        let msg = String(err || "error");
        if (msg.indexOf("language-not-supported") !== -1) {
          msg = "Language not supported by this browser. Type commands below instead.";
        } else if (msg.indexOf("language-fallback:") === 0) {
          msg = "Switched language to " + msg.split(":")[1];
        } else if (msg.indexOf("network") !== -1) {
          msg = "Network required for speech in this browser. Type commands instead.";
        } else if (msg.indexOf("not-allowed") !== -1 || msg.indexOf("permission") !== -1) {
          msg = "Microphone blocked — allow access in browser settings.";
        }
        VoiceCore._updateUI({ error: msg });
      };

      Mic.onStart = () => {
        VoiceCore.listening = true;
        VoiceCore._updateUI({ listening: true });
      };

      Mic.onEnd = () => {
        VoiceCore.listening = false;
        VoiceCore._updateUI({ listening: false });
      };

      if (opts.autoUI !== false) {
        VoiceCore._createUI(opts.container);
      }

      // Start collapsed as blue orb; expand only on Brave Activate
      VoiceCore.setOrbMode(true);

      // Prefer mounting under #game so browser fullscreen still shows the blob
      try {
        const game = document.getElementById("game");
        if (game && VoiceCore.ui.root && VoiceCore.ui.root.parentElement !== game) {
          game.appendChild(VoiceCore.ui.root);
        }
      } catch (_) {}
      VoiceCore.ensureInFullscreenHost();

      // Keep panel inside fullscreen element whenever FS changes
      if (!VoiceCore._fsHooked) {
        VoiceCore._fsHooked = true;
        const onFs = () => {
          setTimeout(() => {
            VoiceCore.ensureInFullscreenHost();
            // Keep mic usable after FS transitions
            if (!VoiceCore.dormant && VoiceCore.Settings.get("enabled")) {
              try { VoiceCore.start(); } catch (_) {}
            } else if (VoiceCore.dormant && VoiceCore.Settings.get("enabled")) {
              // soft listen for wake words
              try { VoiceCore.Microphone.start(); } catch (_) {}
            }
          }, 50);
        };
        document.addEventListener("fullscreenchange", onFs);
        document.addEventListener("webkitfullscreenchange", onFs);
      }

      // Load personal voice profile and inject learned variants
      if (VoiceCore.Trainer) {
        VoiceCore.Trainer.load();
        setTimeout(() => {
          try { VoiceCore.Trainer.applyToRegistry(); } catch (_) {}
        }, 800);
      }

      VoiceCore.ready = true;
      return true;
    },

    /** Register a command (proxy to registry) */
    register(def) {
      const r = VoiceCore.CommandRegistry.register(def);
      // Rebuild recognizer so SpeechGrammarList can pick up new phrases (best-effort)
      if (VoiceCore.ready && VoiceCore.Microphone && typeof VoiceCore.Microphone.rebuild === "function") {
        try { VoiceCore.Microphone.rebuild(); } catch (_) {}
      }
      return r;
    },

    /** Start listening */
    start() {
      if (!VoiceCore.Settings.get("enabled")) return false;
      return VoiceCore.Microphone.start();
    },

    /** Stop listening */
    stop() {
      VoiceCore.Microphone.stop();
    },

    /** Toggle listening */
    toggle() {
      if (VoiceCore.listening) {
        VoiceCore.stop();
        return false;
      }
      return VoiceCore.start();
    },

    /** Speak a message */
    speak(text) {
      return VoiceCore.VoiceResponse.speak(text);
    },

    /** Process text as if it was spoken (for testing / keyboard fallback) */
    async processText(text) {
      return VoiceCore.ExecutionEngine.process(text);
    },

    /** Set current UI context for context-aware commands */
    setContext(ctx) {
      VoiceCore.ExecutionEngine.setContext(ctx);
    },


    // Wake phrases (normalised substrings / exact tokens)
    _WAKE_PHRASES: [
      "hey brave", "hi brave", "okay brave", "ok brave",
      "brave", "brave activate", "activate brave",
      "activate", "engage", "turn on",
      "hey assistant", "assistant"
    ],
    // Phrases that force sleep even when spoken as commands
    _SLEEP_PHRASES: [
      "brave disengage", "disengage brave", "brave sleep", "sleep brave",
      "deactivate", "disengage",
      "brave offline", "go to sleep", "stop listening", "brave shut down",
      "this engage", "dis engage", "dengage", "these engage", "stand down", "dismiss brave",
      "turn off voice", "voice off"
    ],

    _norm(s) {
      return String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    },

    _isWakePhrase(text, alternatives) {
      const list = [text].concat(Array.isArray(alternatives) ? alternatives : []);
      for (const raw of list) {
        const t = VoiceCore._norm(raw);
        if (!t) continue;
        for (const w of VoiceCore._WAKE_PHRASES) {
          if (t === w || t.startsWith(w + " ") || t.endsWith(" " + w) || t.includes(" " + w + " ")) {
            return true;
          }
          // Single-token exact for short wakes like "brave" / "activate"
          if ((w === "brave" || w === "activate" || w === "engage") && t === w) return true;
        }
      }
      return false;
    },

    _stripWake(text) {
      let t = VoiceCore._norm(text);
      const ordered = VoiceCore._WAKE_PHRASES.slice().sort((a, b) => b.length - a.length);
      for (const w of ordered) {
        if (t.startsWith(w + " ")) {
          t = t.slice(w.length).trim();
          break;
        }
        if (t === w) return "";
      }
      return t;
    },

    /** After a command: turn mic off, go dormant, collapse to blob, then soft-listen for wake */
    _sleepAfterCommand(opts) {
      opts = opts || {};
      VoiceCore.dormant = true;
      if (opts.collapse !== false) {
        VoiceCore.setOrbMode(true);
      }
      // Hard stop mic as requested
      try { VoiceCore.Microphone.stop(); } catch (_) {}
      VoiceCore.listening = false;
      VoiceCore._updateUI({ listening: false });

      // Soft restart shortly so verbal wake words still work
      if (VoiceCore._wakeRestartTimer) clearTimeout(VoiceCore._wakeRestartTimer);
      VoiceCore._wakeRestartTimer = setTimeout(() => {
        VoiceCore._wakeRestartTimer = null;
        if (VoiceCore.dormant && VoiceCore.Settings.get("enabled")) {
          try { VoiceCore.Microphone.start(); } catch (_) {}
        }
      }, 900);
    },

    /** Collapse to AI blob or expand to full panel */

    _awaitingFixReply: false,
    _fixOfferAt: 0,

    offerAutoFix(level) {
      if (!VoiceCore.Settings || !VoiceCore.Settings.get("enabled")) return;
      // Debounce: at most once every 45s
      const now = Date.now();
      if (now - (VoiceCore._fixOfferAt || 0) < 45000) return;
      VoiceCore._fixOfferAt = now;
      VoiceCore._awaitingFixReply = true;
      const msg = level === "critical"
        ? "Critical plant state detected. Should I fix it automatically? Say yes or no."
        : "Warning detected. Should I fix it automatically? Say yes or no.";
      try {
        VoiceCore.activate();
      } catch (_) {}
      if (VoiceCore.speak) VoiceCore.speak(msg);
      // Auto-cancel wait after 20s
      setTimeout(() => {
        if (VoiceCore._awaitingFixReply) {
          VoiceCore._awaitingFixReply = false;
        }
      }, 20000);
    },

    setOrbMode(orb) {
      VoiceCore.orbMode = !!orb;
      VoiceCore.expanded = !orb;
      const root = VoiceCore.ui.root;
      if (!root) return;
      if (orb) {
        root.classList.add("vc-orb");
        root.classList.remove("vc-expanded", "minimised");
        root.classList.toggle("vc-dormant", !!VoiceCore.dormant);
        // Clear forced dimensions from expanded state
        root.style.width = "";
        root.style.height = "";
        root.onclick = (e) => {
          if (root.classList.contains("vc-orb") && !root.dataset.dragging) {
            e.preventDefault();
            e.stopPropagation();
            VoiceCore.activate();
          }
        };
      } else {
        root.classList.remove("vc-orb", "vc-dormant", "minimised");
        root.classList.add("vc-expanded");
        root.onclick = null;
      }
    },

    /** Brave Activate — expand panel + start listening + leave dormant */
    activate(opts) {
      opts = opts || {};
      VoiceCore.dormant = false;
      if (VoiceCore._wakeRestartTimer) {
        clearTimeout(VoiceCore._wakeRestartTimer);
        VoiceCore._wakeRestartTimer = null;
      }
      VoiceCore.ensureInFullscreenHost();
      VoiceCore.setOrbMode(false);
      // Always attempt mic start on activate (user gesture from click or wake)
      try {
        if (VoiceCore.Settings.get("enabled") !== false) {
          VoiceCore.Settings.set("enabled", true);
          VoiceCore.start();
        }
      } catch (e) {
        console.warn("[VoiceCore] mic start on activate", e);
      }
      if (!opts.silent && VoiceCore.VoiceResponse && VoiceCore.Settings.get("voiceFeedback")) {
        VoiceCore.speak("Brave online.");
      }
      return true;
    },

    /** Brave Disengage — collapse to blob + sleep */
    disengage() {
      VoiceCore._sleepAfterCommand({ collapse: true });
      if (VoiceCore.VoiceResponse && VoiceCore.Settings.get("voiceFeedback")) {
        VoiceCore.speak("Brave disengaged.");
      }
      return true;
    },


    /**
     * Browser fullscreen only shows nodes inside the fullscreen element.
     * Keep the panel inside #game (or the FS element) so the blob stays visible
     * and clickable, and the mic UI remains usable.
     */
    ensureInFullscreenHost() {
      const panel = VoiceCore.ui && VoiceCore.ui.root;
      if (!panel) return;
      const fsEl =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement ||
        null;
      const game = document.getElementById("game");
      const target = fsEl || (game && (game.classList.contains("immersive") || game.classList.contains("pseudo-fullscreen")) ? game : null);
      if (target) {
        if (panel.parentElement !== target) {
          target.appendChild(panel);
        }
        panel.style.zIndex = "2147483000";
        panel.style.pointerEvents = "auto";
        panel.style.display = "block";
        panel.style.visibility = "visible";
        panel.style.opacity = "1";
      } else if (game && panel.parentElement !== game && panel.parentElement !== document.body) {
        // Prefer living under #game so future FS works
        try { game.appendChild(panel); } catch (_) {}
      }
    },

    /** Start personal voice training session */
    startTraining() {
      if (!VoiceCore.Trainer) {
        console.warn("[VoiceCore] Trainer module not loaded");
        return false;
      }
      // Ensure expanded so user can see context
      VoiceCore.setOrbMode(false);
      VoiceCore.Trainer.start();
      return true;
    },

    // ---------- UI ----------

    _createUI(container) {
      let host = null;
      if (typeof container === "string") host = document.querySelector(container);
      else if (container instanceof HTMLElement) host = container;
      if (!host) host = document.body;

      // Avoid duplicate
      if (document.getElementById("voicecore-panel")) {
        VoiceCore.ui.root = document.getElementById("voicecore-panel");
        VoiceCore._bindUI();
        return;
      }

      const panel = document.createElement("div");
      panel.id = "voicecore-panel";
      panel.className = "vc-panel";
      panel.innerHTML = `
        <div class="vc-header">
          <span class="vc-title">VOICE CORE</span>
          <button type="button" class="vc-btn-icon" id="vc-minimize" title="Minimise">−</button>
        </div>
        <div class="vc-body">
          <div class="vc-toolbar">
            <button type="button" class="vc-mic-btn" id="vc-mic" title="Toggle listening" aria-pressed="false">
              <span class="vc-mic-icon">🎙</span>
              <span class="vc-mic-label">Start</span>
            </button>
          </div>
          <div class="vc-status" id="vc-status">Ready</div>
          <div class="vc-transcript">
            <div class="vc-label">Hearing</div>
            <div class="vc-partial" id="vc-partial">—</div>
            <div class="vc-label">Last command</div>
            <div class="vc-final" id="vc-final">—</div>
          </div>
          <div class="vc-response" id="vc-response"></div>
          <input type="text" class="vc-manual" id="vc-manual" placeholder="Type a command…" autocomplete="off" />
          <div class="vc-controls">
            <label class="vc-toggle">
              <input type="checkbox" id="vc-feedback" checked />
              Voice feedback
            </label>
            <label class="vc-toggle">
              <input type="checkbox" id="vc-enabled" checked />
              Enabled
            </label>
          </div>
          <div class="vc-actions-row">
            <button type="button" class="vc-train-btn" id="vc-train" title="Train on your voice">
              ✦ Train profile
            </button>
            <button type="button" class="vc-collapse-btn" id="vc-collapse" title="Collapse to blob">
              ● Blob
            </button>
          </div>
          <div class="vc-train-stats" id="vc-train-stats"></div>
          <div class="vc-history-wrap">
            <div class="vc-label">History</div>
            <ul class="vc-history" id="vc-history"></ul>
          </div>
          <div class="vc-hint">Wake: Hey Brave · Sleep: Disengage · Profiles in Settings</div>
        </div>
      `;
      host.appendChild(panel);
      VoiceCore.ui.root = panel;
      VoiceCore._bindUI();
    },

    _bindUI() {
      const $ = (id) => document.getElementById(id);
      const micBtn = $("vc-mic");
      const status = $("vc-status");
      const partial = $("vc-partial");
      const finalEl = $("vc-final");
      const response = $("vc-response");
      const history = $("vc-history");
      const feedback = $("vc-feedback");
      const enabled = $("vc-enabled");
      const manual = $("vc-manual");
      const minimize = $("vc-minimize");

      VoiceCore.ui.btn = micBtn;
      VoiceCore.ui.status = status;
      VoiceCore.ui.transcript = { partial, final: finalEl };
      VoiceCore.ui.history = history;
      VoiceCore.ui.response = response;

      if (micBtn) {
        micBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // User gesture: enable mic path and toggle listening
          try { VoiceCore.Settings.set("enabled", true); } catch (_) {}
          VoiceCore.dormant = false;
          const on = VoiceCore.toggle();
          if (!on) {
            // If toggle stopped, that's fine; if start failed, try once more
            try { VoiceCore.start(); } catch (_) {}
          }
          const listening = !!(VoiceCore.Microphone && VoiceCore.Microphone.isListening) || VoiceCore.listening;
          micBtn.setAttribute("aria-pressed", listening ? "true" : "false");
          const label = micBtn.querySelector(".vc-mic-label");
          if (label) label.textContent = listening ? "Listening…" : "Start";
          micBtn.classList.toggle("listening", listening);
          if (VoiceCore.ui.root) VoiceCore.ui.root.classList.toggle("listening", listening);
        });
      }

      if (feedback) {
        feedback.checked = VoiceCore.Settings.get("voiceFeedback");
        feedback.addEventListener("change", () => {
          VoiceCore.Settings.set("voiceFeedback", feedback.checked);
          VoiceCore.VoiceResponse.setEnabled(feedback.checked);
        });
      }

      if (enabled) {
        enabled.checked = VoiceCore.Settings.get("enabled");
        enabled.addEventListener("change", () => {
          VoiceCore.Settings.set("enabled", enabled.checked);
          if (!enabled.checked) VoiceCore.stop();
        });
      }

      if (manual) {
        manual.addEventListener("keydown", async (e) => {
          if (e.key === "Enter") {
            const text = manual.value.trim();
            if (!text) return;
            manual.value = "";
            const result = await VoiceCore.processText(text);
            VoiceCore._updateUI({ final: text, result });
          }
        });
      }

      const collapseToBlob = () => {
        VoiceCore.dormant = true;
        if (VoiceCore._wakeRestartTimer) {
          clearTimeout(VoiceCore._wakeRestartTimer);
          VoiceCore._wakeRestartTimer = null;
        }
        try { VoiceCore.Microphone.stop(); } catch (_) {}
        VoiceCore.listening = false;
        const root = VoiceCore.ui.root;
        if (root) {
          root.style.width = "";
          root.style.height = "";
          root.classList.remove("minimised", "vc-expanded");
          root.classList.add("vc-orb", "vc-dormant");
        }
        VoiceCore.setOrbMode(true);
        VoiceCore._updateUI({ listening: false });
        VoiceCore._wakeRestartTimer = setTimeout(() => {
          VoiceCore._wakeRestartTimer = null;
          if (VoiceCore.dormant && VoiceCore.Settings.get("enabled")) {
            try { VoiceCore.Microphone.start(); } catch (_) {}
          }
        }, 900);
      };

      if (minimize) {
        minimize.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          collapseToBlob();
        });
      }
      const collapseBtn = $("vc-collapse");
      if (collapseBtn) {
        collapseBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          collapseToBlob();
        });
      }

      const trainBtn = $("vc-train");
      if (trainBtn) {
        trainBtn.addEventListener("click", () => {
          VoiceCore.startTraining();
        });
      }

      VoiceCore._refreshTrainStats();
      VoiceCore._initBlobDrag();
    },

    /** Allow repositioning the blob (especially useful in fullscreen) */
    _initBlobDrag() {
      const root = VoiceCore.ui.root;
      if (!root || root.dataset.dragBound) return;
      root.dataset.dragBound = "1";

      let dragging = false;
      let startX = 0, startY = 0, origLeft = 0, origTop = 0;
      let moved = false;

      const onDown = (e) => {
        // Only drag when in orb/blob form
        if (!root.classList.contains("vc-orb")) return;
        const point = e.touches ? e.touches[0] : e;
        dragging = true;
        moved = false;
        root.dataset.dragging = "";
        startX = point.clientX;
        startY = point.clientY;
        const rect = root.getBoundingClientRect();
        // Switch from right/bottom anchoring to left/top for free placement
        root.style.left = rect.left + "px";
        root.style.top = rect.top + "px";
        root.style.right = "auto";
        root.style.bottom = "auto";
        origLeft = rect.left;
        origTop = rect.top;
        e.preventDefault();
      };

      const onMove = (e) => {
        if (!dragging) return;
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - startX;
        const dy = point.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          moved = true;
          root.dataset.dragging = "1";
        }
        let nx = origLeft + dx;
        let ny = origTop + dy;
        const margin = 8;
        const maxX = window.innerWidth - root.offsetWidth - margin;
        const maxY = window.innerHeight - root.offsetHeight - margin;
        nx = Math.max(margin, Math.min(maxX, nx));
        ny = Math.max(margin, Math.min(maxY, ny));
        root.style.left = nx + "px";
        root.style.top = ny + "px";
        e.preventDefault();
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        // If user dragged, don't treat as click-to-activate
        if (moved) {
          root.dataset.dragging = "1";
          setTimeout(() => { delete root.dataset.dragging; }, 80);
        } else {
          delete root.dataset.dragging;
        }
      };

      root.addEventListener("mousedown", onDown);
      root.addEventListener("touchstart", onDown, { passive: false });
      window.addEventListener("mousemove", onMove);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchend", onUp);
    },

    _refreshTrainStats() {
      const el = document.getElementById("vc-train-stats");
      if (!el || !VoiceCore.Trainer) return;
      try { VoiceCore.Trainer.ensureProfiles(); } catch (_) {}
      const s = VoiceCore.Trainer.stats();
      const name = (VoiceCore.Trainer.profile && VoiceCore.Trainer.profile.name) || "Default";
      if (s.samples > 0) {
        el.textContent = name + " · " + s.samples + " samples · " + s.phrases + " phrases";
      } else {
        el.textContent = name + " · no samples yet";
      }
    },

    _updateUI(state) {
      const ui = VoiceCore.ui;
      if (!ui.root) return;

      if (state.listening != null) {
        if (ui.root) {
          ui.root.classList.toggle("listening", state.listening);
        }
        if (ui.btn) {
          ui.btn.classList.toggle("listening", state.listening);
          ui.btn.setAttribute("aria-pressed", state.listening ? "true" : "false");
          const label = ui.btn.querySelector(".vc-mic-label");
          if (label) label.textContent = state.listening ? "Listening…" : "Start";
        }
      }

      if (ui.status) {
        if (state.error) ui.status.textContent = "Error: " + state.error;
        else if (state.listening) ui.status.textContent = "Listening…";
        else ui.status.textContent = "Ready";
      }

      if (state.partial != null && ui.transcript && ui.transcript.partial) {
        ui.transcript.partial.textContent = state.partial || "—";
      }
      if (state.final != null && ui.transcript && ui.transcript.final) {
        ui.transcript.final.textContent = state.final || "—";
      }

      if (state.result && ui.response) {
        const r = state.result;
        if (r.ok) {
          const conf = (typeof r.score === "number" && r.score > 0)
            ? " (" + Math.round(r.score * 100) + "%)"
            : "";
          ui.response.textContent = "✓ " + (r.command ? r.command.name : "ok") + conf;
        } else {
          ui.response.textContent = "✗ " + (r.message || "failed");
        }
        ui.response.className = "vc-response " + (r.ok ? "ok" : "fail");
      }

      try { VoiceCore._refreshTrainStats(); } catch (_) {}

      if (ui.history) {
        const items = VoiceCore.ExecutionEngine.getHistory().slice(0, 8);
        ui.history.innerHTML = items.map((h) => {
          const cls = h.success ? "ok" : "fail";
          const name = h.commandName || "—";
          return `<li class="${cls}"><span class="cmd">${escapeHtml(name)}</span> <span class="txt">${escapeHtml(h.text)}</span></li>`;
        }).join("");
      }
    }
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})(typeof window !== "undefined" ? window : globalThis);
