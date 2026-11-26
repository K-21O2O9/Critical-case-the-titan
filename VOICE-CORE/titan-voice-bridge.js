/**
 * Titan ↔ VoiceCore bridge (keep VoiceCore separate)
 *
 * - Loads/installs VoiceCore after the player enters the engine room
 * - Starts listening when switching to Walk mode (explore the ship)
 * - Works on walk-only builds that auto-enter without a Start button click
 * - Works even if speech recognition is unavailable (typed commands still work)
 */
(function (global) {
  "use strict";

  const Bridge = {
    installed: false,
    installPromise: null,
    _listeningArmed: false,

    /** Call once after Game is running (e.g. Enter Engine Room click or auto-walk). */
    ensureInstalled(opts) {
      if (this.installed) return Promise.resolve(true);
      if (this.installPromise) return this.installPromise;

      this.installPromise = (async () => {
        // Wait briefly for late script tags if needed
        let tries = 0;
        while ((!global.VoiceCore || !global.VoiceCoreTitan) && tries < 40) {
          await new Promise((r) => setTimeout(r, 50));
          tries++;
        }
        if (!global.VoiceCore || !global.VoiceCoreTitan) {
          console.warn("[VoiceBridge] VoiceCore scripts not loaded.");
          this.installPromise = null;
          return false;
        }
        try {
          await VoiceCoreTitan.install({
            greet: false,
            autoUI: true,
            lang: (opts && opts.lang) || "en-US"
          });
          this.installed = true;
          this._hookSectorNav();
          // Soft-start recognition for wake words; user can also click the blob
          try {
            if (global.VoiceCore) {
              if (typeof VoiceCore.ensureInFullscreenHost === "function") {
                VoiceCore.ensureInFullscreenHost();
              }
              VoiceCore.dormant = true;
              if (VoiceCore.Settings) VoiceCore.Settings.set("enabled", true);
              if (VoiceCore.Microphone && VoiceCore.Microphone.start) {
                VoiceCore.Microphone.start();
              }
            }
          } catch (_) {}
          if (global.Game && Game.log) {
            Game.log("Voice ready — say Hey Brave, click the blue blob, or type in the voice panel.");
          }
          return true;
        } catch (e) {
          console.warn("[VoiceBridge] install failed:", e);
          this.installPromise = null;
          return false;
        }
      })();

      return this.installPromise;
    },

    /** Start mic (may prompt permission). Safe no-op if unsupported. */
    async enableListening() {
      await this.ensureInstalled();
      if (!global.VoiceCore) return false;
      try {
        if (VoiceCore.VoiceResponse && VoiceCore.Settings && VoiceCore.Settings.get("voiceFeedback")) {
          try { VoiceCore.speak("Walk mode. Voice listening."); } catch (_) {}
        }
        if (typeof VoiceCore.setContext === "function") VoiceCore.setContext("walk");
        if (typeof VoiceCore.start === "function") return !!VoiceCore.start();
        if (VoiceCore.Microphone && VoiceCore.Microphone.start) {
          VoiceCore.Microphone.start();
          return true;
        }
        return false;
      } catch (e) {
        console.warn("[VoiceBridge] start:", e);
        return false;
      }
    },

    softStop() {
      try {
        if (global.VoiceCore && typeof VoiceCore.stop === "function") VoiceCore.stop();
      } catch (_) {}
    },

    _hookSectorNav() {
      if (!global.InputManager || this._hooked) return;
      this._hooked = true;

      const orig = InputManager.showSector.bind(InputManager);
      InputManager.showSector = (id) => {
        orig(id);
        if (id === "walk") {
          this.enableListening();
          if (global.VoiceCore && typeof VoiceCore.setContext === "function") {
            VoiceCore.setContext("walk");
          }
        } else {
          if (global.VoiceCore && typeof VoiceCore.setContext === "function") {
            VoiceCore.setContext(id || null);
          }
        }
      };
    },

    /**
     * Walk-only / auto-start entry: install + listen once the game shell is live.
     * Safe to call multiple times.
     */
    armForWalk(delayMs) {
      if (this._listeningArmed) return;
      this._listeningArmed = true;
      const delay = typeof delayMs === "number" ? delayMs : 700;
      setTimeout(() => {
        this.ensureInstalled().then((ok) => {
          if (!ok) {
            // Retry once — scripts may still be parsing
            setTimeout(() => {
              this.ensureInstalled().then((ok2) => {
                if (ok2) this.enableListening();
              });
            }, 800);
            return;
          }
          this.enableListening();
        });
      }, delay);
    }
  };

  global.TitanVoiceBridge = Bridge;

  // Classic path: Start button click
  function attachToStartButton() {
    const btn = document.getElementById("btn-start");
    if (!btn || btn.dataset.voiceBridgeAttached) return;
    btn.dataset.voiceBridgeAttached = "1";
    btn.addEventListener("click", () => {
      setTimeout(() => {
        Bridge.ensureInstalled();
      }, 500);
    });
  }

  // Walk-only path: game becomes visible without Start click
  function watchWalkAutoStart() {
    let checks = 0;
    const tick = () => {
      checks++;
      const game = document.getElementById("game");
      const load = document.getElementById("loading-screen");
      const gameVisible = game && !game.classList.contains("hidden");
      const loadHidden = !load || load.classList.contains("hidden");
      const hasGame = !!(global.Game && global.SceneManager);
      if (gameVisible && loadHidden && hasGame) {
        Bridge.armForWalk(400);
        return;
      }
      if (checks < 120) setTimeout(tick, 100);
    };
    setTimeout(tick, 300);
  }

  function bootBridge() {
    attachToStartButton();
    watchWalkAutoStart();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootBridge);
  } else {
    bootBridge();
  }
})(typeof window !== "undefined" ? window : globalThis);
