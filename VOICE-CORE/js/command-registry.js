/**
 * VoiceCore — Command Registry (v2)
 * High-accuracy fuzzy matching with multi-hypothesis support,
 * synonym expansion, token-level Levenshtein, and length-aware scoring.
 */
(function (global) {
  "use strict";

  // Lightweight synonym / equivalent map for common spoken variations
  const SYNONYMS = {
    start: ["start", "begin", "activate", "engage", "turn on", "switch on", "enable", "power on", "fire up", "kick on"],
    stop: ["stop", "halt", "deactivate", "disengage", "turn off", "switch off", "disable", "power off", "shut down", "kill", "cut"],
    disengage: ["disengage", "this engage", "dis engage", "dengage", "deseengage", "these engage", "disengaged", "stand down", "dismiss"],
    engage: ["engage", "engaged", "in gage", "in gauge"],
    fix: ["fix", "six", "ficks", "repair", "resolve", "clear"],
    six: ["fix", "six"],
    crisis: ["crisis", "critical", "emergency"],
    on: ["on", "enable", "activate", "engage"],
    off: ["off", "disable", "deactivate", "disengage"],
    open: ["open", "release", "unlock"],
    close: ["close", "shut", "lock"],
    increase: ["increase", "raise", "boost", "higher", "up", "more"],
    decrease: ["decrease", "lower", "reduce", "down", "less"],
    status: ["status", "report", "state", "condition", "how is", "what is"],
    everything: ["everything", "all", "all systems", "the lot", "whole system"],
    engine: ["engine", "engines", "propulsion", "motor", "motors"],
    motor: ["motor", "motors", "engine", "engines"],
    motors: ["motor", "motors", "engine", "engines"],
    cooling: ["cooling", "coolant", "cooler", "coolers"],
    coolant: ["coolant", "cooling", "cooler"],
    cooler: ["cooler", "coolers", "coolant", "cooling"],
    main: ["main", "primary"],
    breaker: ["breaker", "circuit breaker", "switch"],
    emergency: ["emergency", "emergency stop", "e-stop", "estop", "scram"],
    throttle: ["throttle", "throttles", "throddle", "throtle", "throtlle", "power", "thrust"],
    throttles: ["throttle", "throttles", "throddle", "throtle"],
    throddle: ["throttle"],
    throtle: ["throttle"],
    throtlle: ["throttle"],
    reactor: ["reactor", "reactors", "core"],
    generator: ["generator", "genny", "gen"],
    regulator: ["regulator", "regulation", "auto reg", "autoreg"],
    clutch: ["clutch", "coupler"],
    fuel: ["fuel", "fool", "full"],  // ASR often confuses fuel/full
    air: ["air", "intake"],
    map: ["map", "navigation", "nav", "position"],
    projection: ["projection", "hologram", "holo"],
    hologram: ["hologram", "holo", "projection"],
    recalibrate: ["recalibrate", "re calibrate", "calibrate", "reset heat"],
    one: ["one", "1", "won"],
    two: ["two", "2", "to", "too"],
    yes: ["yes", "yeah", "yep", "yup", "confirm", "affirmative", "do it", "proceed", "ok", "okay", "sure"],
    no: ["no", "nope", "nah", "cancel", "abort", "stop", "don't", "do not", "negative"]
  };

  // Invert synonyms for fast lookup
  const TOKEN_EQUIV = {};
  for (const group of Object.values(SYNONYMS)) {
    const set = new Set(group.map((g) => g.toLowerCase()));
    for (const t of set) {
      TOKEN_EQUIV[t] = set;
    }
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = a.length;
    const n = b.length;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[n];
  }

  function tokenSimilarity(t1, t2) {
    if (t1 === t2) return 1.0;
    const eq = TOKEN_EQUIV[t1];
    if (eq && eq.has(t2)) return 0.92;

    const minLen = Math.min(t1.length, t2.length);
    if (minLen >= 3 && (t1.startsWith(t2) || t2.startsWith(t1))) {
      return 0.78 + 0.1 * (minLen / Math.max(t1.length, t2.length));
    }

    const dist = levenshtein(t1, t2);
    const maxLen = Math.max(t1.length, t2.length);
    if (maxLen === 0) return 0;
    const sim = 1 - dist / maxLen;
    if (sim >= 0.65 || (maxLen <= 5 && dist <= 1) || (maxLen <= 9 && dist <= 2) || (maxLen <= 12 && dist <= 3)) {
      return Math.max(0, sim * 0.92);
    }
    return 0;
  }

  const CommandRegistry = {
    _commands: new Map(),

    register(def) {
      if (!def || !def.name || !Array.isArray(def.phrases) || typeof def.action !== "function") {
        console.warn("[VoiceCore] Invalid command definition", def);
        return;
      }
      const phrases = def.phrases
        .map((p) => String(p).toLowerCase().trim())
        .filter(Boolean);

      const tokenised = phrases.map((p) => this._tokenize(p));

      this._commands.set(def.name, {
        name: def.name,
        phrases,
        _tokenised: tokenised,
        action: def.action,
        response: def.response || null,
        confirm: !!def.confirm,
        context: def.context || null
      });
    },

    unregister(name) {
      this._commands.delete(name);
    },

    clear() {
      this._commands.clear();
    },

    list() {
      return Array.from(this._commands.values());
    },

    /**
     * Find best matching command.
     * Accepts either a single string or an array of alternative transcripts.
     */
    match(textOrAlts, currentContext) {
      const hypotheses = Array.isArray(textOrAlts)
        ? textOrAlts
        : [String(textOrAlts || "")];

      let best = null;
      let bestScore = 0;

      for (const hyp of hypotheses) {
        const normalised = this._normalise(hyp);
        if (!normalised || normalised.length < 2) continue;

        const tokens = this._tokenize(normalised);
        if (tokens.length === 0) continue;

        for (const cmd of this._commands.values()) {
          if (cmd.context && currentContext && cmd.context !== currentContext) continue;

          for (let i = 0; i < cmd.phrases.length; i++) {
            const phrase = cmd.phrases[i];
            const pTokens = cmd._tokenised[i];
            const score = this._score(tokens, normalised, pTokens, phrase);

            if (score > bestScore) {
              bestScore = score;
              best = {
                command: cmd,
                score,
                matchedPhrase: phrase,
                hypothesis: hyp
              };
            }
          }
        }
      }

      const threshold = best && best.matchedPhrase.split(/\s+/).length <= 2 ? 0.52 : 0.45;
      if (best && bestScore >= threshold) return best;
      return null;
    },

    _normalise(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[^\w\s']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    },

    _tokenize(text) {
      return text
        .split(/\s+/)
        .filter((w) => w.length > 1);
    },

    _score(textTokens, fullText, phraseTokens, phrase) {
      if (fullText === phrase) return 1.0;

      if (fullText.includes(phrase)) {
        const coverage = phrase.length / Math.max(fullText.length, 1);
        return 0.88 + 0.1 * Math.min(coverage, 1);
      }
      if (phrase.includes(fullText) && fullText.length > 3) {
        return 0.72;
      }

      if (phraseTokens.length === 0) return 0;

      let matchedWeight = 0;
      const used = new Set();

      for (const pTok of phraseTokens) {
        let bestTokScore = 0;
        let bestIdx = -1;
        for (let i = 0; i < textTokens.length; i++) {
          if (used.has(i)) continue;
          const sim = tokenSimilarity(pTok, textTokens[i]);
          if (sim > bestTokScore) {
            bestTokScore = sim;
            bestIdx = i;
          }
        }
        if (bestTokScore > 0 && bestIdx >= 0) {
          used.add(bestIdx);
          matchedWeight += bestTokScore;
        }
      }

      let score = matchedWeight / phraseTokens.length;

      if (score > 0.75 && textTokens.length <= phraseTokens.length + 2) {
        score = Math.min(1, score + 0.06);
      }

      if (score >= 0.65 && phraseTokens.length >= 3) {
        score = Math.min(1, score + 0.03 * Math.min(phraseTokens.length - 2, 3));
      }

      return score;
    }
  };

  global.VoiceCore = global.VoiceCore || {};
  global.VoiceCore.CommandRegistry = CommandRegistry;
})(typeof window !== "undefined" ? window : globalThis);
