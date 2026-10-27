/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with bot/scenarios/ladder-crazy-logs.json and `npm run bot:analyze` (/bot-tune).
 *
 * A weaker hopper lands sloppily (noise), ignores how its landing spins the log (spinAware), hesitates, walks
 * slowly, misses jet warnings and has lapses.
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { reactionMs: 420, lapse: 0.3, speed: 0.6, noise: 22, spinAware: 0, jetAware: 0.1, edgeMargin: 2, hesitate: 0.35, crowd: 0 },
  normal: { reactionMs: 260, lapse: 0.12, speed: 0.8, noise: 14, spinAware: 0.4, jetAware: 0.5, edgeMargin: 5, hesitate: 0.18, crowd: 0.4 },
  hard: { reactionMs: 150, lapse: 0.04, speed: 0.92, noise: 8, spinAware: 0.75, jetAware: 0.85, edgeMargin: 8, hesitate: 0.08, crowd: 0.8 },
  expert: { reactionMs: 70, lapse: 0, speed: 1, noise: 4, spinAware: 0.95, jetAware: 1, edgeMargin: 10, hesitate: 0.03, crowd: 1 },
  semigod: { reactionMs: 0, lapse: 0, speed: 1, noise: 0, spinAware: 1, jetAware: 1, edgeMargin: 10, hesitate: 0, crowd: 1 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
