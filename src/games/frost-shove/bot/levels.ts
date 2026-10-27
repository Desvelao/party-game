/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with bot/scenarios/ladder-<variant>.json and `npm run bot:analyze` (/bot-tune).
 *
 * What makes a bear weaker is what makes a person weaker: late reactions, sloppy positioning and aim (noise), lapses,
 * walking to the edge without noticing (edgeMargin, lookahead), dashing at bad angles, slow mashing in the water.
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { reactionMs: 400, lapse: 0.3, speed: 0.7, noise: 60, edgeMargin: 30, lookahead: 0.25, dashAlign: 0, dashRange: 0.6, dodge: 0, items: 0.2, carry: 0.2, aggro: 0.4, mash: 5.5, camp: 0, bombLead: 0 },
  normal: { reactionMs: 250, lapse: 0.12, speed: 0.85, noise: 35, edgeMargin: 45, lookahead: 0.35, dashAlign: 0.15, dashRange: 0.8, dodge: 0.4, items: 0.5, carry: 0.5, aggro: 0.7, mash: 6, camp: 0, bombLead: 0.3 },
  hard: { reactionMs: 140, lapse: 0.04, speed: 0.95, noise: 18, edgeMargin: 60, lookahead: 0.45, dashAlign: 0.25, dashRange: 0.9, dodge: 0.8, items: 0.8, carry: 0.8, aggro: 0.9, mash: 8, camp: 0.3, bombLead: 0.7 },
  expert: { reactionMs: 60, lapse: 0, speed: 1, noise: 6, edgeMargin: 70, lookahead: 0.5, dashAlign: 0.3, dodge: 1, items: 1, carry: 1, aggro: 1, mash: 10, camp: 0.7, bombLead: 1 },
  semigod: { reactionMs: 0, lapse: 0, speed: 1, noise: 0, edgeMargin: 75, lookahead: 0.55, dashAlign: 0.35, dodge: 1, items: 1, carry: 1, aggro: 1, mash: 12, bombLead: 1 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
