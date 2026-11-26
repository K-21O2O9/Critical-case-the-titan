/**
 * VoiceCore — Microphone & recognition bridge (v2)
 * High-reliability Web Speech API layer with multi-hypothesis support,
 * robust continuous listening, language fallbacks, and broad browser coverage.
 */
(function (global) {
  "use strict";

  // Ordered fallbacks when the preferred language is rejected by the browser
  const LANG_FALLBACKS = [
    "en-US",
    "en-GB",
    "en",
    "en-AU",
    "en-CA",
    "en-IN",
    "en-NZ",
    "en-IE"
  ];

  // Common filler words and noise that ASR often injects
  const FILLERS = /\b(um+|uh+|er+|ah+|hmm+|like|you know|please|can you|could you|would you|i want to|i need to|hey|okay|ok)\b/gi;

  const Microphone = {
    recognition: null,
    isListening: false,
    isSupported: false,
    continuous: true,
    interimResults: true,
    lang: "en-US",
    maxAlternatives: 5,
    onPartial: null,
    onFinal: null,          // receives (bestText, alternatives[])
    onError: null,
    onStart: null,
    onEnd: null,
    _restarting: false,
    _wantListen: false,
    _langIndex: 0,
    _triedLocal: true,
    _restartDelay: 220,
    _maxRestartDelay: 1800,
    _consecutiveErrors: 0,
    _lastFinalAt: 0,

    init(options = {}) {
      const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition ||
        window.mozSpeechRecognition ||
        window.msSpeechRecognition;

      if (!SpeechRecognition) {
        this.isSupported = false;
        console.warn("[VoiceCore] Web Speech API not supported in this browser.");
        return false;
      }
      this.isSupported = true;

      const preferred = options.lang || "en-US";
      this.lang = preferred;
      this.continuous = options.continuous !== false;
      this.interimResults = options.interimResults !== false;
      this.maxAlternatives = Math.min(Math.max(options.maxAlternatives || 5, 1), 5);

      // Build try-list: preferred first, then fallbacks (deduped)
      this._langList = [preferred].concat(
        LANG_FALLBACKS.filter((l) => l.toLowerCase() !== preferred.toLowerCase())
      );
      this._langIndex = 0;

      this._createRecognizer(this._langList[0]);
      return true;
    },

    _createRecognizer(lang) {
      const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition ||
        window.mozSpeechRecognition ||
        window.msSpeechRecognition;

      // Clean up previous instance
      if (this.recognition) {
        try {
          this.recognition.onstart = null;
          this.recognition.onend = null;
          this.recognition.onerror = null;
          this.recognition.onresult = null;
          this.recognition.abort();
        } catch (_) {}
      }

      this.recognition = new SpeechRecognition();
      this.recognition.continuous = this.continuous;
      this.recognition.interimResults = this.interimResults;
      this.recognition.lang = lang;
      this.lang = lang;
      this.recognition.maxAlternatives = this.maxAlternatives;

      // Prefer on-device recognition when the browser exposes the flag (Chrome 124+, Edge, etc.)
      this._triedLocal = true;
      try {
        if ("processLocally" in this.recognition) {
          this.recognition.processLocally = true;
        }
      } catch (_) {
        this._triedLocal = false;
      }

      // Optional: constrained recognition via SpeechGrammarList when available
      // (helps accuracy for known command vocabularies; silently ignored if unsupported)
      try {
        const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
        if (SpeechGrammarList && global.VoiceCore && global.VoiceCore.CommandRegistry) {
          const phrases = [];
          const list = global.VoiceCore.CommandRegistry.list();
          for (const cmd of list) {
            for (const p of cmd.phrases) phrases.push(p);
          }
          if (phrases.length > 0 && phrases.length < 80) {
            const grammar = "#JSGF V1.0; grammar commands; public <command> = " +
              phrases.map((p) => p.replace(/[()|*;<>]/g, "")).join(" | ") + " ;";
            const gl = new SpeechGrammarList();
            gl.addFromString(grammar, 1.0);
            this.recognition.grammars = gl;
          }
        }
      } catch (_) {
        // Grammar support is optional and browser-dependent
      }

      this.recognition.onstart = () => {
        this.isListening = true;
        this._consecutiveErrors = 0;
        this._restartDelay = 220;
        if (this.onStart) this.onStart();
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.onEnd) this.onEnd();
        if (this._wantListen && !this._restarting) {
          this._scheduleRestart();
        }
      };

      this.recognition.onerror = (ev) => {
        const err = (ev && ev.error) || "unknown";

        // Benign / recoverable
        if (err === "no-speech" || err === "aborted") {
          // Keep listening if still wanted; continuous mode will restart via onend
          return;
        }

        this._consecutiveErrors += 1;

        // Language not available → try next fallback or drop processLocally
        if (err === "language-not-supported") {
          console.warn("[VoiceCore] Language not supported:", this.lang);

          // 1) First try turning off processLocally (some builds only support cloud for that lang)
          if (this._triedLocal && "processLocally" in this.recognition) {
            this._triedLocal = false;
            try {
              this.recognition.processLocally = false;
              console.info("[VoiceCore] Retrying without processLocally for", this.lang);
              if (this._wantListen) this._scheduleRestart(180);
              return;
            } catch (_) {}
          }

          // 2) Try next language in the fallback list
          this._langIndex += 1;
          if (this._langIndex < this._langList.length) {
            const next = this._langList[this._langIndex];
            console.info("[VoiceCore] Falling back to language:", next);
            this._createRecognizer(next);
            if (this._wantListen) this._scheduleRestart(200);
            if (this.onError) {
              this.onError("language-fallback:" + next, ev);
            }
            return;
          }

          // 3) Exhausted
          if (this.onError) {
            this.onError(
              "language-not-supported (tried: " + this._langList.join(", ") + "). Use the text box instead.",
              ev
            );
          }
          this._wantListen = false;
          return;
        }

        // Network / service issues – common when on-device is unavailable
        if (err === "network" || err === "service-not-allowed") {
          if (this.onError) {
            this.onError(
              err + " — this browser may need a network connection for speech recognition. You can still type commands.",
              ev
            );
          }
          // Still attempt gentle restart a few times
          if (this._wantListen && this._consecutiveErrors < 4) {
            this._scheduleRestart(Math.min(600 * this._consecutiveErrors, 2000));
          }
          return;
        }

        if (err === "not-allowed" || err === "permission-denied") {
          if (this.onError) {
            this.onError("Microphone permission denied. Allow the mic, then try again.", ev);
          }
          this._wantListen = false;
          return;
        }

        if (err === "audio-capture") {
          if (this.onError) {
            this.onError("No microphone detected or it is in use by another application.", ev);
          }
          return;
        }

        if (this.onError) this.onError(err, ev);

        // Soft recovery for unknown transient errors
        if (this._wantListen && this._consecutiveErrors < 5) {
          this._scheduleRestart(Math.min(400 * this._consecutiveErrors, 2500));
        }
      };

      this.recognition.onresult = (ev) => {
        let interim = "";
        const finalAlts = []; // { transcript, confidence }

        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (res.isFinal) {
            // Collect all alternatives for this final result
            for (let a = 0; a < res.length; a++) {
              const t = (res[a].transcript || "").trim();
              if (t) {
                finalAlts.push({
                  transcript: t,
                  confidence: typeof res[a].confidence === "number" ? res[a].confidence : 0.5
                });
              }
            }
          } else {
            // Interim – take top hypothesis only
            interim += (res[0] && res[0].transcript) || "";
          }
        }

        if (interim && this.onPartial) {
          this.onPartial(this._clean(interim));
        }

        if (finalAlts.length && this.onFinal) {
          // Deduplicate while preserving order (best first)
          const seen = new Set();
          const unique = [];
          for (const alt of finalAlts) {
            const key = alt.transcript.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              unique.push(alt);
            }
          }

          // Sort by confidence descending when available
          unique.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

          const best = this._clean(unique[0].transcript);
          const alternatives = unique.map((u) => this._clean(u.transcript));

          // Debounce extremely rapid finals (some engines fire duplicates)
          const now = Date.now();
          if (now - this._lastFinalAt < 120 && best === (this._lastBest || "")) {
            return;
          }
          this._lastFinalAt = now;
          this._lastBest = best;

          this.onFinal(best, alternatives);
        }
      };
    },

    _clean(text) {
      return String(text || "")
        .replace(FILLERS, " ")
        .replace(/\s+/g, " ")
        .trim();
    },

    _scheduleRestart(delay) {
      if (this._restarting || !this._wantListen) return;
      this._restarting = true;
      const d = delay != null ? delay : this._restartDelay;
      setTimeout(() => {
        this._restarting = false;
        if (this._wantListen) {
          // Gentle exponential backoff after repeated issues
          this._restartDelay = Math.min(
            this._restartDelay * 1.35,
            this._maxRestartDelay
          );
          this._startRaw();
        }
      }, d);
    },

    start() {
      if (!this.recognition) return false;
      this._wantListen = true;
      this._consecutiveErrors = 0;
      this._restartDelay = 220;
      return this._startRaw();
    },

    _startRaw() {
      if (!this.recognition || this.isListening) return false;
      try {
        this.recognition.start();
        return true;
      } catch (e) {
        // InvalidStateError is normal when already started
        if (e.name !== "InvalidStateError") {
          console.warn("[VoiceCore] recognition.start()", e);
          if (this.onError) this.onError(e.message || "start-failed");
          // Retry shortly
          if (this._wantListen) this._scheduleRestart(350);
        }
        return false;
      }
    },

    stop() {
      this._wantListen = false;
      this._restarting = false;
      if (!this.recognition) return;
      try {
        this.recognition.stop();
      } catch (_) {}
      this.isListening = false;
    },

    abort() {
      this._wantListen = false;
      this._restarting = false;
      if (!this.recognition) return;
      try {
        this.recognition.abort();
      } catch (_) {}
      this.isListening = false;
    },

    /** Change language at runtime and rebuild recognizer */
    setLang(lang) {
      if (!lang) return;
      this._langList = [lang].concat(
        LANG_FALLBACKS.filter((l) => l.toLowerCase() !== String(lang).toLowerCase())
      );
      this._langIndex = 0;
      const wasListening = this._wantListen;
      this.stop();
      this._createRecognizer(lang);
      if (wasListening) this.start();
    },

    /** Force rebuild (e.g. after commands registered so grammar can be applied) */
    rebuild() {
      const wasListening = this._wantListen;
      this.stop();
      this._createRecognizer(this.lang);
      if (wasListening) this.start();
    }
  };

  global.VoiceCore = global.VoiceCore || {};
  global.VoiceCore.Microphone = Microphone;
})(typeof window !== "undefined" ? window : globalThis);
