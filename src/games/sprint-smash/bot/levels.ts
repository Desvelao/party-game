/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with bot/scenarios/ladder-<variant>.json and `npm run bot:analyze` (/bot-tune).
 *
 * A weaker racer drives a wide, wobbly line, lifts off the throttle, sees hazards late and wastes its items.
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { reactionMs: 420, lapse: 0.3, line: 0, noise: 40, throttle: 0.65, dodge: 0.15, items: 0.3, lookahead: 0.5, jumpRods: 1 },
  normal: { reactionMs: 260, lapse: 0.12, line: 0.35, noise: 24, throttle: 0.75, dodge: 0.45, items: 0.6, lookahead: 0.7 },
  hard: { reactionMs: 150, lapse: 0.04, line: 0.7, noise: 12, throttle: 0.9, dodge: 0.8, items: 0.85, lookahead: 0.9 },
  expert: { reactionMs: 70, lapse: 0, line: 0.9, noise: 5, throttle: 1, dodge: 1, items: 1, lookahead: 1 },
  semigod: { reactionMs: 0, lapse: 0, line: 1, noise: 0, throttle: 1, dodge: 1, items: 1, lookahead: 1 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
