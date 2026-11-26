/**
 * VoiceCore Speech AI — local, offline phrase recovery
 * Purpose: identify spoken words better and match commands more efficiently
 * without a network model. Works with Web Speech alternatives + fuzzy repair.
 *
 * Folder: VOICE-CORE/ai/
 */
(function (global) {
  "use strict";

  // Common ASR confusions → preferred tokens (marine / Titan domain)
  const PHONETIC = {
    engage: ["and gauge", "in gauge", "in gage", "engaged", "engage", "and gage", "on gauge"],
    disengage: ["this engage", "dis engage", "dengage", "deseengage", "these engage"],
    map: ["nap", "mac", "mapped", "maps", "app", "mapp"],
    display: ["displays", "the play", "this play", "displayed", "dis play"],
    navigation: ["navi gation", "navigational", "nav", "navy gation"],
    brave: ["brain", "brave", "breve", "rave", "grave"],
    reactor: ["re actor", "erector", "react or"],
    cooling: ["cool in", "calling", "culling"],
    electrics: ["electric", "electronics", "electro"],
    motors: ["motor", "motors", "moto"],
    throttle: ["trottle", "throttle", "throtle"],
    clutch: ["cluch", "clutch", "cloche"],
    fuel: ["full", "fool", "few el"],
    status: ["stat us", "state us", "statuses"],
    emergency: ["emergancy", "emergencies"],
    critical: ["criticle", "crisis", "critcal"],
    walk: ["work", "wok", "walked"],
    hologram: ["holo gram", "holograms", "holograph"],
    projection: ["pro jection", "projections"],
    fix: ["six", "ficks", "fics"],
    start: ["started", "stuart", "star"],
    stop: ["stopped", "stahp"],
    open: ["opened"],
    close: ["closed", "clothes", "clause"]
  };

  // Multi-word phrase repairs (heard → intended)
  const PHRASE_REPAIRS = [
    [/engage\s+display\s+map/g, "engage display map"],
    [/and\s+gauge\s+display\s+map/g, "engage display map"],
    [/in\s+gauge\s+display\s+map/g, "engage display map"],
    [/engage\s+the\s+display\s+map/g, "engage display map"],
    [/display\s+the\s+map/g, "display map"],
    [/show\s+the\s+map/g, "show map"],
    [/open\s+the\s+map/g, "open map"],
    [/hey\s+brain/g, "hey brave"],
    [/hey\s+grave/g, "hey brave"],
    [/this\s+engage/g, "disengage"],
    [/fix\s+crisis/g, "fix crisis"],
    [/six\s+crisis/g, "fix crisis"]
  ];

  function tokens(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^\w\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
  }

  function lev(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = a.length, n = b.length;
    // banded / early exit for efficiency
    if (Math.abs(m - n) > 3) return Math.max(m, n);
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > 3) return Math.max(m, n);
      const tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  function jaccard(aTok, bTok) {
    if (!aTok.length || !bTok.length) return 0;
    const A = new Set(aTok), B = new Set(bTok);
    let inter = 0;
    A.forEach((t) => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  const SpeechAI = {
    version: "1.1.0",
    _index: null, // Map token -> phrase strings
    _phrases: [],
    _stats: { calls: 0, repairs: 0, boosts: 0 },

    /** Build / refresh inverted index from CommandRegistry (efficient lookup). */
    rebuildIndex() {
      const phrases = [];
      try {
        const Reg = global.VoiceCore && global.VoiceCore.CommandRegistry;
        if (Reg && typeof Reg.list === "function") {
          Reg.list().forEach((cmd) => {
            (cmd.phrases || []).forEach((p) => phrases.push(String(p).toLowerCase()));
          });
        }
      } catch (_) {}
      // Always include map engagement variants
      [
        "engage display map",
        "display map",
        "show map",
        "open map",
        "navigation map",
        "engage map",
        "show navigation map"
      ].forEach((p) => phrases.push(p));

      const index = Object.create(null);
      phrases.forEach((p) => {
        tokens(p).forEach((t) => {
          if (!index[t]) index[t] = [];
          if (index[t].indexOf(p) < 0) index[t].push(p);
        });
      });
      this._phrases = phrases;
      this._index = index;
      return phrases.length;
    },

    normalise(text) {
      let s = String(text || "").toLowerCase();
      s = s.replace(/\b(um+|uh+|er+|ah+|hmm+|like|you know|please|can you|could you|would you)\b/g, " ");
      PHRASE_REPAIRS.forEach(([re, rep]) => { s = s.replace(re, rep); });
      // Token-level phonetic repair
      const out = tokens(s).map((t) => {
        for (const [canon, variants] of Object.entries(PHONETIC)) {
          if (t === canon) return canon;
          for (let i = 0; i < variants.length; i++) {
            if (t === variants[i] || lev(t, variants[i]) <= 1) return canon;
          }
          if (lev(t, canon) <= 1 && t.length >= 3) return canon;
        }
        return t;
      });
      return out.join(" ").replace(/\s+/g, " ").trim();
    },

    /**
     * Improve one or more ASR hypotheses. Returns ranked candidate strings.
     * @param {string|string[]} textOrAlts
     * @returns {{ primary: string, candidates: string[], repaired: boolean }}
     */
    enhance(textOrAlts) {
      this._stats.calls++;
      if (!this._index) this.rebuildIndex();

      const rawList = Array.isArray(textOrAlts)
        ? textOrAlts.map(String)
        : [String(textOrAlts || "")];

      const scored = [];
      const seen = Object.create(null);

      const push = (text, baseScore, tag) => {
        const norm = this.normalise(text);
        if (!norm || seen[norm]) return;
        seen[norm] = 1;
        // Lexicon proximity boost
        let boost = 0;
        const tks = tokens(norm);
        const candidatePhrases = new Set();
        tks.forEach((t) => {
          const hits = this._index[t];
          if (hits) hits.forEach((p) => candidatePhrases.add(p));
        });
        let bestJac = 0;
        let bestLev = 99;
        candidatePhrases.forEach((p) => {
          const pt = tokens(p);
          const j = jaccard(tks, pt);
          if (j > bestJac) bestJac = j;
          const d = lev(norm, p);
          if (d < bestLev) bestLev = d;
        });
        if (bestJac > 0.45) boost += 0.15 + bestJac * 0.35;
        if (bestLev <= 2) boost += 0.25;
        if (bestLev <= 4 && norm.length > 6) boost += 0.08;
        if (tag === "repair") boost += 0.05;
        scored.push({ text: norm, score: baseScore + boost, tag });
      };

      rawList.forEach((t, i) => {
        const conf = Math.max(0.15, 1 - i * 0.12);
        push(t, conf, "asr");
        const repaired = this.normalise(t);
        if (repaired !== String(t).toLowerCase().trim()) {
          this._stats.repairs++;
          push(repaired, conf + 0.1, "repair");
        }
      });

      // Nearest phrase injection when close (efficient: only index-touched phrases)
      const primaryTok = tokens(this.normalise(rawList[0] || ""));
      const near = new Set();
      primaryTok.forEach((t) => {
        const hits = this._index[t];
        if (hits) hits.forEach((p) => near.add(p));
        // fuzzy token key scan limited
        Object.keys(this._index).forEach((k) => {
          if (Math.abs(k.length - t.length) <= 1 && lev(k, t) <= 1) {
            this._index[k].forEach((p) => near.add(p));
          }
        });
      });
      near.forEach((p) => {
        const d = lev(this.normalise(rawList[0] || ""), p);
        if (d <= 4) {
          this._stats.boosts++;
          push(p, 0.55 - d * 0.05, "lexicon");
        }
      });

      scored.sort((a, b) => b.score - a.score);
      const candidates = scored.map((s) => s.text);
      const primary = candidates[0] || this.normalise(rawList[0] || "");
      return {
        primary,
        candidates: candidates.slice(0, 8),
        repaired: scored.some((s) => s.tag === "repair" || s.tag === "lexicon")
      };
    },

    /** Convenience: enhance then return array for Registry.match */
    enhanceList(textOrAlts) {
      const r = this.enhance(textOrAlts);
      return r.candidates.length ? r.candidates : [r.primary];
    },

    stats() {
      return { ...this._stats, phrases: this._phrases.length };
    }
  };

  global.VoiceCore = global.VoiceCore || {};
  global.VoiceCore.SpeechAI = SpeechAI;
  global.TitanSpeechAI = SpeechAI;

  // Auto-index shortly after load (registry may fill later)
  function tryIndex() {
    try { SpeechAI.rebuildIndex(); } catch (_) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(tryIndex, 400));
  } else {
    setTimeout(tryIndex, 400);
  }
})(typeof window !== "undefined" ? window : globalThis);
