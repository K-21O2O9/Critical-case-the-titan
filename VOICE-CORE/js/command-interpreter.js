/**
 * VoiceCore — Interpreter layer (v2 + Speech AI)
 * Normalisation + multi-hypothesis routing into the registry matcher.
 * Uses VoiceCore.SpeechAI when present for better word recovery.
 */
(function (global) {
  "use strict";

  const CommandInterpreter = {
    /**
     * Interpret raw text or alternative transcripts and return the best command match.
     * @param {string|string[]} textOrAlts
     * @param {string|null} context
     */
    interpret(textOrAlts, context) {
      const Registry = global.VoiceCore && global.VoiceCore.CommandRegistry;
      if (!Registry) return null;

      let payload = textOrAlts;
      try {
        const AI = global.VoiceCore && global.VoiceCore.SpeechAI;
        if (AI && typeof AI.enhanceList === "function") {
          payload = AI.enhanceList(textOrAlts);
        }
      } catch (_) {}

      return Registry.match(payload, context);
    },

    /**
     * Aggressive normalisation for free-form speech.
     * Prefer SpeechAI.normalise when available.
     */
    normalise(text) {
      try {
        const AI = global.VoiceCore && global.VoiceCore.SpeechAI;
        if (AI && typeof AI.normalise === "function") {
          return AI.normalise(text);
        }
      } catch (_) {}
      return String(text || "")
        .toLowerCase()
        .replace(/\b(um+|uh+|er+|ah+|hmm+|like|you know|please|can you|could you|would you|i want to|i need to|hey)\b/gi, " ")
        .replace(/[^\w\s']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  };

  global.VoiceCore = global.VoiceCore || {};
  global.VoiceCore.CommandInterpreter = CommandInterpreter;
})(typeof window !== "undefined" ? window : globalThis);
