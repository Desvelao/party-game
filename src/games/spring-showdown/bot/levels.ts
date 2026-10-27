/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with bot/scenarios/ladder-<variant>.json and `npm run bot:analyze` (/bot-tune).
 *
 * A weaker player looks fewer hops ahead, values squares sloppily, forgets to bank, fires items blindly, walks into
 * missiles and TNT, and (in Spring Lock) sometimes lands on its own colour.
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { reactionMs: 450, lapse: 0.3, depth: 1, noise: 1.3, bank: 0.25, aim: 0, items: 0.3, hazards: 0, enclose: 0, careful: 0.6 },
  normal: { reactionMs: 280, lapse: 0.12, depth: 2, noise: 0.5, bank: 0.7, aim: 0.4, items: 0.6, hazards: 0.4, enclose: 0, careful: 0.85 },
  hard: { reactionMs: 160, lapse: 0.04, depth: 3, noise: 0.25, bank: 1, aim: 0.75, items: 0.85, hazards: 0.8, enclose: 1, careful: 1 },
  expert: { reactionMs: 80, lapse: 0, depth: 3, noise: 0.1, bank: 1.2, aim: 1, items: 1, hazards: 1, enclose: 1, careful: 1 },
  semigod: { reactionMs: 0, lapse: 0, depth: 4, noise: 0, bank: 1.2, aim: 1, items: 1, hazards: 1, enclose: 1, careful: 1 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
