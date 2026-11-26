/**
 * VoiceCore — Spoken responses via Web Speech Synthesis (offline-capable)
 */
(function (global) {
  "use strict";

  const VoiceResponse = {
    enabled: true,
    rate: 0.92,
    pitch: 0.95,
    volume: 1.0,
    voiceURI: null, // preferred voice
    _queue: [],
    _speaking: false,

    init() {
      if (!("speechSynthesis" in window)) {
        console.warn("[VoiceCore] speechSynthesis not available");
        return;
      }
      // Load voices (Chrome needs a delay / voiceschanged)
      const load = () => {
        const voices = speechSynthesis.getVoices();
        if (voices.length && !this.voiceURI) {
          // Prefer local / offline-capable English voice
          // Prefer natural / soft English voices when available
          const prefer = (v) => {
            const n = (v.name || "").toLowerCase();
            return /samantha|karen|moira|fiona|veena|tessa|siri|natural|premium|enhanced|neural|google us|microsoft (aria|jenny|sara|zira)/i.test(n);
          };
          const en = voices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
          const soft = en.find(prefer) || en.find((v) => v.localService) || en.find((v) => v.default) || en[0];
          if (soft) this.voiceURI = soft.voiceURI;
        }
      };
      load();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = load;
      }
    },

    setEnabled(on) {
      this.enabled = !!on;
      if (!on) this.cancel();
    },

    /**
     * Optional clip overrides: VOICE-CORE/voice-clips/{stem}.(mp3|opus|ogg|wav|m4a|webm)
     * See Brave-Speech-Lines.pdf for stem names. Empty folder = pure TTS.
     */
    clipBase: (typeof window !== "undefined" && window.__VOICE_CORE_BASE__ ? window.__VOICE_CORE_BASE__ + "voice-clips/" : "VOICE-CORE/voice-clips/"),
    clipExts: [".mp3", ".opus", ".ogg", ".wav", ".m4a", ".webm"],
    _clipCache: {}, // stem -> url or null

    slug(text) {
      return String(text || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 80) || "phrase";
    },

    async resolveClip(text) {
      const stem = this.slug(text);
      // short aliases
      const aliases = {
        activation: ["brave online", "brave engaged", "activation confirmed"],
        brave_online: ["brave online"],
        brave_disengaged: ["brave disengaged"],
        brave_engaged: ["brave engaged"]
      };
      const stems = [stem];
      Object.keys(aliases).forEach((a) => {
        if (aliases[a].some((p) => this.slug(p) === stem || String(text).toLowerCase().indexOf(p) === 0)) {
          stems.unshift(a);
        }
      });
      // activation short name for "Brave online."
      if (/brave online/i.test(text)) stems.unshift("activation");

      for (let s = 0; s < stems.length; s++) {
        const key = stems[s];
        if (Object.prototype.hasOwnProperty.call(this._clipCache, key)) {
          if (this._clipCache[key]) return this._clipCache[key];
          continue;
        }
        for (let i = 0; i < this.clipExts.length; i++) {
          const url = this.clipBase + key + this.clipExts[i];
          try {
            const res = await fetch(url, { method: "GET", cache: "no-cache" });
            if (res && res.ok) {
              this._clipCache[key] = url;
              return url;
            }
          } catch (_) {}
        }
        this._clipCache[key] = null;
      }
      return null;
    },

    playClip(url) {
      return new Promise((resolve) => {
        try {
          const audio = new Audio(url);
          audio.volume = this.volume;
          const done = () => { this._speaking = false; resolve(); this._drain(); };
          audio.onended = done;
          audio.onerror = done;
          this._speaking = true;
          const p = audio.play();
          if (p && p.catch) p.catch(done);
        } catch (_) {
          this._speaking = false;
          resolve();
          this._drain();
        }
      });
    },

    speak(text, opts = {}) {
      if (!this.enabled || !text) return Promise.resolve();
      const str = String(text);

      // Prefer optional file override when present
      return this.resolveClip(str).then((url) => {
        if (url) {
          // queue clip as a function job
          return new Promise((resolve) => {
            this._queue.push({ __clip: url, __resolve: resolve });
            this._drain();
          });
        }
        if (!("speechSynthesis" in window)) return Promise.resolve();

        return new Promise((resolve) => {
          const utt = new SpeechSynthesisUtterance(str);
          utt.rate = opts.rate != null ? opts.rate : this.rate;
          utt.pitch = opts.pitch != null ? opts.pitch : this.pitch;
          utt.volume = opts.volume != null ? opts.volume : this.volume;

          if (this.voiceURI) {
            const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === this.voiceURI);
            if (voice) utt.voice = voice;
          } else {
            const en = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("en"));
            if (en) utt.voice = en;
          }

          utt.onend = () => { this._speaking = false; resolve(); this._drain(); };
          utt.onerror = () => { this._speaking = false; resolve(); this._drain(); };

          this._queue.push(utt);
          this._drain();
        });
      });
    },

    _drain() {
      if (this._speaking || this._queue.length === 0) return;
      const next = this._queue.shift();
      if (next && next.__clip) {
        this.playClip(next.__clip).then(() => {
          if (next.__resolve) next.__resolve();
        });
        return;
      }
      this._speaking = true;
      try {
        speechSynthesis.speak(next);
      } catch (e) {
        this._speaking = false;
        this._drain();
      }
    },

    cancel() {
      this._queue = [];
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      this._speaking = false;
    },

    /** Convenience short replies */
    ok(msg) { return this.speak(msg || "Done."); },
    error(msg) { return this.speak(msg || "Sorry, I did not understand that."); },
    ready() { return this.speak("Voice system ready."); }
  };

  global.VoiceCore = global.VoiceCore || {};
  global.VoiceCore.VoiceResponse = VoiceResponse;
})(typeof window !== "undefined" ? window : globalThis);
