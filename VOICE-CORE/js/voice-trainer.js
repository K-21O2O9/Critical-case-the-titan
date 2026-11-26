/**
 * VoiceCore — Personal Voice Trainer (v2)
 *
 * Practical on-device adaptation:
 * 1. Presents known command phrases one by one.
 * 2. User speaks each phrase.
 * 3. Captures what the browser actually recognised.
 * 4. Stores those real-world variants as extra aliases for the matching commands.
 * 5. Persists a personal profile in localStorage and reloads it on every session.
 *
 * This measurably improves recognition for a specific speaker without any cloud ML.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "voicecore-voice-profiles-v2";

  const Trainer = {
    active: false,
    profiles: {},          // id -> { id, name, variants, trainedAt, samples }
    activeProfileId: "default",
    profile: { variants: {}, trainedAt: null, samples: 0 },
    _queue: [],
    _current: null,
    _resolveStep: null,
    _ui: null,
    _originalOnFinal: null,

    ensureProfiles() {
      this.load();
      if (!this.profiles || !Object.keys(this.profiles).length) {
        this.profiles = {
          default: { id: "default", name: "Default", variants: {}, trainedAt: null, samples: 0 }
        };
        this.activeProfileId = "default";
        this.profile = this.profiles.default;
        this.save();
      }
      if (!this.profiles[this.activeProfileId]) {
        this.activeProfileId = Object.keys(this.profiles)[0];
      }
      this.profile = this.profiles[this.activeProfileId];
      return this.profiles;
    },

    listProfiles() {
      this.ensureProfiles();
      return Object.values(this.profiles);
    },

    createProfile(name) {
      this.ensureProfiles();
      const id = "p_" + Date.now().toString(36);
      this.profiles[id] = { id: id, name: name || "Profile", variants: {}, trainedAt: null, samples: 0 };
      this.activeProfileId = id;
      this.profile = this.profiles[id];
      this.save();
      this.applyToRegistry();
      return id;
    },

    setActiveProfile(id) {
      this.ensureProfiles();
      if (!this.profiles[id]) return;
      this.activeProfileId = id;
      this.profile = this.profiles[id];
      this.save();
      this.applyToRegistry();
    },

    renameProfile(id, name) {
      this.ensureProfiles();
      if (!this.profiles[id]) return;
      this.profiles[id].name = name || this.profiles[id].name;
      this.save();
    },

    deleteProfile(id) {
      this.ensureProfiles();
      if (id === "default" || !this.profiles[id]) return;
      delete this.profiles[id];
      if (this.activeProfileId === id) {
        this.activeProfileId = "default";
        this.profile = this.profiles.default || Object.values(this.profiles)[0];
      }
      this.save();
      this.applyToRegistry();
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          // Migrate v1 single profile
          if (data.variants && !data.profiles) {
            this.profiles = {
              default: {
                id: "default",
                name: "Default",
                variants: data.variants || {},
                trainedAt: data.trainedAt || null,
                samples: data.samples || 0
              }
            };
            this.activeProfileId = "default";
          } else {
            this.profiles = data.profiles || {};
            this.activeProfileId = data.activeProfileId || "default";
          }
        } else {
          // try old key
          const old = localStorage.getItem("voicecore-voice-profile-v1");
          if (old) {
            const data = JSON.parse(old);
            this.profiles = {
              default: {
                id: "default",
                name: "Default",
                variants: data.variants || {},
                trainedAt: data.trainedAt || null,
                samples: data.samples || 0
              }
            };
            this.activeProfileId = "default";
          } else {
            this.profiles = {
              default: { id: "default", name: "Default", variants: {}, trainedAt: null, samples: 0 }
            };
            this.activeProfileId = "default";
          }
        }
      } catch (_) {
        this.profiles = {
          default: { id: "default", name: "Default", variants: {}, trainedAt: null, samples: 0 }
        };
        this.activeProfileId = "default";
      }
      if (!this.profiles[this.activeProfileId]) {
        this.activeProfileId = Object.keys(this.profiles)[0] || "default";
      }
      this.profile = this.profiles[this.activeProfileId] || { variants: {}, trainedAt: null, samples: 0 };
      return this.profile;
    },

    save() {
      try {
        // keep active profile object in sync
        if (this.activeProfileId && this.profiles[this.activeProfileId]) {
          this.profiles[this.activeProfileId] = this.profile;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          profiles: this.profiles,
          activeProfileId: this.activeProfileId
        }));
      } catch (e) {
        console.warn("[VoiceTrainer] could not save profile", e);
      }
    },

    /**
     * Apply learned variants into the live CommandRegistry.
     * Call after commands are registered (and after load).
     */
    applyToRegistry() {
      const Registry = global.VoiceCore && global.VoiceCore.CommandRegistry;
      if (!Registry) return 0;
      let added = 0;
      for (const [canonical, alts] of Object.entries(this.profile.variants || {})) {
        // Find which command owns this canonical phrase
        for (const cmd of Registry.list()) {
          if (cmd.phrases.includes(canonical.toLowerCase())) {
            for (const alt of alts) {
              const a = String(alt).toLowerCase().trim();
              if (a && !cmd.phrases.includes(a)) {
                cmd.phrases.push(a);
                // Keep token cache in sync
                if (cmd._tokenised) {
                  cmd._tokenised.push(
                    a.split(/\s+/).filter((w) => w.length > 1)
                  );
                }
                added++;
              }
            }
            break;
          }
        }
      }
      if (added > 0) {
        console.info("[VoiceTrainer] Applied", added, "personal variants to registry");
      }
      return added;
    },

    /**
     * Build a training queue from currently registered commands.
     * Prefers the primary (first) phrase of each command + a few high-value ones.
     */
    buildQueue(max = 28) {
      const Registry = global.VoiceCore && global.VoiceCore.CommandRegistry;
      if (!Registry) return [];
      const seen = new Set();
      const queue = [];
      // Prefer shorter, high-frequency style phrases first
      const priority = [
        "throttle up", "throttle down", "full throttle",
        "turn on motor one", "turn on motor two", "turn off motor two",
        "start engines", "engage clutch",
        "regulate reactor", "set fuel", "set air",
        "set coolant", "start cooling", "maximum cooling",
        "display map", "remove map", "show projection",
        "auto regulate on", "set throttle",
        "emergency stop", "recalibrate", "heat status",
        "status report", "alternate motors",
        "show reactor", "show regulator", "walk mode"
      ];
      for (const p of priority) {
        if (queue.length >= max) break;
        const pl = p.toLowerCase();
        if (seen.has(pl)) continue;
        // Only if some command owns a similar phrase
        let owned = false;
        for (const cmd of Registry.list()) {
          if (cmd.phrases.some((x) => x.includes(pl.split(" ")[0]))) { owned = true; break; }
        }
        if (!owned) continue;
        seen.add(pl);
        queue.push({ commandName: "priority", phrase: pl });
      }
      const cmds = Registry.list().slice().sort((a, b) => {
        const la = (a.phrases[0] || "").split(/\s+/).length;
        const lb = (b.phrases[0] || "").split(/\s+/).length;
        return la - lb;
      });
      for (const cmd of cmds) {
        if (queue.length >= max) break;
        const primary = (cmd.phrases[0] || "").toLowerCase().trim();
        if (!primary || seen.has(primary)) continue;
        if (cmd.name === "brave_activate" || cmd.name === "brave_disengage") continue;
        seen.add(primary);
        queue.push({ commandName: cmd.name, phrase: primary });
      }
      return queue;
    },

    /**
     * Start interactive training session.
     * Shows overlay, walks through phrases, records what was heard.
     */
    async start() {
      if (this.active) return;
      this.load();
      this._queue = this.buildQueue(28);
      if (this._queue.length === 0) {
        if (global.VoiceCore && global.VoiceCore.speak) {
          global.VoiceCore.speak("No commands registered to train.");
        }
        return;
      }

      this.active = true;
      this._createOverlay();
      this._showIntro();

      // Temporarily take over recognition callbacks
      const Mic = global.VoiceCore && global.VoiceCore.Microphone;
      if (Mic) {
        this._originalOnFinal = Mic.onFinal;
        this._originalOnPartial = Mic.onPartial;
        Mic.onFinal = (text, alts) => this._onHeard(text, alts);
        Mic.onPartial = (text) => this._onPartial(text);
        // Prefer continuous + interim for training (more reliable capture)
        try {
          Mic.continuous = true;
          Mic.interimResults = true;
          if (Mic.recognition) {
            Mic.recognition.continuous = true;
            Mic.recognition.interimResults = true;
            // Cloud path often hears quieter mics better than forced on-device
            try { if ("processLocally" in Mic.recognition) Mic.recognition.processLocally = false; } catch (_) {}
          }
        } catch (_) {}
        try {
          if (global.VoiceCore.Settings) global.VoiceCore.Settings.set("enabled", true);
        } catch (_) {}
        try { Mic.start(); } catch (_) {}
        // Soft restart if engine was dormant
        setTimeout(() => {
          try {
            if (Mic && !Mic.isListening) Mic.start();
          } catch (_) {}
        }, 400);
      }

      // Live waveform / level meter from Web Audio API
      this._startLevelMeter();

      // Avoid speaking over the mic during training — browsers often can't hear while TTS plays
      const hint = this._ui && this._ui.querySelector("#vc-tr-hint");
      if (hint) hint.textContent = "Allow microphone if asked, then press Begin and speak each phrase.";
    },

    stop() {
      if (!this.active) return;
      this.active = false;
      this._current = null;
      this._queue = [];
      this._stopLevelMeter();
      const Mic = global.VoiceCore && global.VoiceCore.Microphone;
      if (Mic) {
        if (this._originalOnFinal) Mic.onFinal = this._originalOnFinal;
        if (this._originalOnPartial) Mic.onPartial = this._originalOnPartial;
        this._originalOnFinal = null;
        this._originalOnPartial = null;
      }
      this._destroyOverlay();
      this.save();
      this.applyToRegistry();
      if (global.VoiceCore && global.VoiceCore.speak) {
        global.VoiceCore.speak(
          "Training complete. I learned " + (this.profile.samples || 0) + " samples from your voice."
        );
      }
    },

    _showIntro() {
      this._render({
        title: "Voice Training",
        body: "I will show you short commands. Speak each one clearly when ready. Your personal pronunciations will be saved so I understand you better.",
        progress: "0 / " + this._queue.length,
        actions: [
          { id: "begin", label: "Begin", primary: true },
          { id: "cancel", label: "Cancel" }
        ]
      });
      this._bindActions({
        begin: () => this._nextPhrase(),
        cancel: () => this.stop()
      });
    },

    _nextPhrase() {
      if (this._queue.length === 0) {
        this._finish();
        return;
      }
      this._current = this._queue.shift();
      const done = this.profile.samples || 0;
      // Keep mic hot between phrases
      const Mic = global.VoiceCore && global.VoiceCore.Microphone;
      try {
        if (Mic && !Mic.isListening) Mic.start();
      } catch (_) {}
      this._render({
        title: "Repeat this command",
        body: this._current.phrase,
        highlight: true,
        listening: true,
        progress: (done + 1) + " · remaining " + this._queue.length,
        hint: "Speak now — watch the wave respond to your voice",
        actions: [
          { id: "skip", label: "Skip" },
          { id: "cancel", label: "End" }
        ]
      });
      this._bindActions({
        skip: () => this._nextPhrase(),
        cancel: () => this.stop()
      });
    },

    _onPartial(text) {
      if (!this.active || !this._current) return;
      const t = String(text || "").trim();
      if (!t) return;
      // Smooth energy rise from speech activity (no second mic stream)
      const boost = Math.min(0.95, 0.25 + Math.min(t.length, 24) / 30);
      this._levelTarget = Math.max(this._levelTarget || 0, boost);
      const hint = this._ui && this._ui.querySelector("#vc-tr-hint");
      if (hint) hint.textContent = "Hearing: “" + t + "”";
    },

    _onHeard(text, alternatives) {
      if (!this.active || !this._current) return;
      const heard = String(text || "").trim();
      if (!heard || heard.length < 1) return;

      const canonical = this._current.phrase;
      const alts = Array.isArray(alternatives) ? alternatives : [heard];
      const all = [heard, ...alts]
        .map((t) => String(t).toLowerCase().trim())
        .filter(Boolean);

      if (!this.profile.variants[canonical]) {
        this.profile.variants[canonical] = [];
      }
      const bucket = this.profile.variants[canonical];
      for (const v of all) {
        if (!bucket.includes(v) && v.length >= 1) bucket.push(v);
      }
      // Also store near-matches of canonical tokens for fuzzy later
      if (bucket.length > 16) bucket.length = 16;

      this.profile.samples = (this.profile.samples || 0) + 1;
      this.profile.trainedAt = new Date().toISOString();
      this.save();

      this._levelTarget = 0.85;
      this._render({
        title: "Captured",
        body: "Heard: “" + heard + "”",
        progress: "Saved · " + this.profile.samples + " samples",
        hint: "Good — next phrase…",
        actions: []
      });

      setTimeout(() => this._nextPhrase(), 550);
    },

    _finish() {
      this._render({
        title: "Training complete",
        body: "Saved " + (this.profile.samples || 0) + " voice samples. Commands will now match your speech more accurately.",
        progress: "",
        actions: [{ id: "done", label: "Done", primary: true }]
      });
      this._bindActions({
        done: () => this.stop()
      });
    },

    _createOverlay() {
      if (this._ui) return;
      const el = document.createElement("div");
      el.id = "vc-trainer-overlay";
      el.className = "vc-trainer-overlay";
      el.innerHTML =
        '<div class="vc-trainer-card">' +
        '<div class="vc-trainer-title" id="vc-tr-title"></div>' +
        '<div class="vc-trainer-body" id="vc-tr-body"></div>' +
        '<div class="vc-trainer-listening" id="vc-tr-listen" hidden><span class="dot"></span> <span id="vc-tr-listen-label">Listening…</span></div>' +
        '<div class="vc-trainer-microw">' +
        '<button type="button" id="vc-tr-mic-toggle" class="primary">Mic: ON</button>' +
        '<span id="vc-tr-mic-state" class="vc-trainer-mic-state">Recognition active</span>' +
        '</div>' +
        '<div class="vc-trainer-wave-wrap">' +
        '<canvas id="vc-tr-wave" width="400" height="64"></canvas>' +
        '<div class="vc-trainer-level" id="vc-tr-level">LEVEL</div>' +
        '</div>' +
        '<div class="vc-trainer-hint" id="vc-tr-hint"></div>' +
        '<div class="vc-trainer-progress" id="vc-tr-progress"></div>' +
        '<div class="vc-trainer-actions" id="vc-tr-actions"></div>' +
        '</div>';
      document.body.appendChild(el);
      this._ui = el;
      this._trainMicOn = true;
      const micBtn = el.querySelector("#vc-tr-mic-toggle");
      if (micBtn) {
        micBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.toggleTrainMic();
        });
      }
    },

    toggleTrainMic() {
      const Mic = global.VoiceCore && global.VoiceCore.Microphone;
      this._trainMicOn = !this._trainMicOn;
      const btn = this._ui && this._ui.querySelector("#vc-tr-mic-toggle");
      const st = this._ui && this._ui.querySelector("#vc-tr-mic-state");
      const listen = this._ui && this._ui.querySelector("#vc-tr-listen");
      if (this._trainMicOn) {
        try { if (Mic) Mic.start(); } catch (_) {}
        if (btn) btn.textContent = "Mic: ON";
        if (st) st.textContent = "Recognition active — speak now";
        if (listen) listen.hidden = false;
      } else {
        try { if (Mic) Mic.stop(); } catch (_) {}
        if (btn) btn.textContent = "Mic: OFF";
        if (st) st.textContent = "Mic off — press Mic: ON to listen";
        if (listen) listen.hidden = true;
      }
    },

    _destroyOverlay() {
      this._stopLevelMeter();
      if (this._ui && this._ui.parentNode) {
        this._ui.parentNode.removeChild(this._ui);
      }
      this._ui = null;
    },

    _startLevelMeter() {
      this._stopLevelMeter();
      // Do NOT open a second getUserMedia stream — it steals the mic from SpeechRecognition
      // on many browsers. Drive a smooth continuous wave from recognition activity instead.
      this._level = 0.08;
      this._levelTarget = 0.08;
      this._wavePhase = 0;
      const canvas = this._ui && this._ui.querySelector("#vc-tr-wave");
      const levelEl = this._ui && this._ui.querySelector("#vc-tr-level");
      const draw = () => {
        if (!this.active) return;
        this._meterRaf = requestAnimationFrame(draw);
        // Smooth exponential approach (realistic meter ballistics)
        this._level += (this._levelTarget - this._level) * 0.12;
        // Natural idle drift when quiet
        this._wavePhase += 0.045 + this._level * 0.08;
        // Slowly decay target toward ambient unless speech keeps it up
        this._levelTarget += (0.07 - this._levelTarget) * 0.04;

        const lvlPct = Math.min(100, Math.round(this._level * 100));
        if (levelEl) {
          levelEl.textContent = lvlPct > 14 ? ("LEVEL " + lvlPct + "%") : "LISTENING";
          levelEl.classList.toggle("hot", lvlPct > 22);
        }
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        // soft fill under wave
        const amp = 0.12 + this._level * 0.55;
        ctx.beginPath();
        for (let x = 0; x <= W; x++) {
          const t = x / W;
          const y =
            H / 2 +
            Math.sin(this._wavePhase + t * Math.PI * 4) * H * amp * 0.55 +
            Math.sin(this._wavePhase * 1.7 + t * Math.PI * 7) * H * amp * 0.25;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = "rgba(54,191,192," + (0.08 + this._level * 0.18) + ")";
        ctx.fill();
        // main stroke
        ctx.beginPath();
        for (let x = 0; x <= W; x++) {
          const t = x / W;
          const y =
            H / 2 +
            Math.sin(this._wavePhase + t * Math.PI * 4) * H * amp * 0.55 +
            Math.sin(this._wavePhase * 1.7 + t * Math.PI * 7) * H * amp * 0.25;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = this._level > 0.2 ? "#36BFC0" : "#5a8a94";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.stroke();
      };
      this._meterRaf = requestAnimationFrame(draw);

      // Keep SpeechRecognition alive during training
      this._trainKeepAlive = setInterval(() => {
        if (!this.active || this._trainMicOn === false) return;
        const Mic = global.VoiceCore && global.VoiceCore.Microphone;
        if (!Mic) return;
        try {
          if (!Mic.isListening) Mic.start();
        } catch (_) {}
      }, 1200);
    },

    _stopLevelMeter() {
      if (this._meterRaf) {
        cancelAnimationFrame(this._meterRaf);
        this._meterRaf = null;
      }
      if (this._trainKeepAlive) {
        clearInterval(this._trainKeepAlive);
        this._trainKeepAlive = null;
      }
      this._meterStream = null;
      this._audioCtx = null;
      this._analyser = null;
      this._meterData = null;
    },

    _render(state) {
      if (!this._ui) return;
      const $ = (id) => this._ui.querySelector("#" + id);
      const title = $("vc-tr-title");
      const body = $("vc-tr-body");
      const hint = $("vc-tr-hint");
      const progress = $("vc-tr-progress");
      const actions = $("vc-tr-actions");
      const listen = $("vc-tr-listen");

      if (title) title.textContent = state.title || "";
      if (body) {
        body.textContent = state.body || "";
        body.classList.toggle("highlight", !!state.highlight);
      }
      if (hint) hint.textContent = state.hint || "";
      if (progress) progress.textContent = state.progress || "";
      if (listen) listen.hidden = !state.listening;
      if (actions) {
        actions.innerHTML = (state.actions || [])
          .map(
            (a) =>
              '<button type="button" class="' + (a.primary ? "primary" : "") + '" data-act="' + a.id + '">' + a.label + "</button>"
          )
          .join("");
      }
    },

    _bindActions(map) {
      if (!this._ui) return;
      const actions = this._ui.querySelector("#vc-tr-actions");
      if (!actions) return;
      actions.onclick = (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const id = btn.getAttribute("data-act");
        if (map[id]) map[id]();
      };
    },

    /** Public stats for UI */
    stats() {
      this.load();
      const variants = (this.profile && this.profile.variants) || {};
      return {
        samples: (this.profile && this.profile.samples) || 0,
        phrases: Object.keys(variants).length,
        trainedAt: (this.profile && this.profile.trainedAt) || null
      };
    },


    clear() {
      this.profile = { variants: {}, trainedAt: null, samples: 0, id: this.activeProfileId, name: (this.profile && this.profile.name) || "Profile" };
      if (this.profiles && this.activeProfileId) this.profiles[this.activeProfileId] = this.profile;
      this.save();
    }
  };

  global.VoiceCore = global.VoiceCore || {};
  global.VoiceCore.Trainer = Trainer;
})(typeof window !== "undefined" ? window : globalThis);
