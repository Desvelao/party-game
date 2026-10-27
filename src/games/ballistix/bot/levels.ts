/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with the ladder scenario (bot/scenarios/ladder.json, ladder-<variant>.json for the other variants) and `npm run bot:analyze`.
 *
 * What makes a bot weaker here is mostly what makes a person weaker: late reactions (reactionMs), a slower
 * paddle (speed), sloppy placement (noise), attention lapses, not reading bank shots (maxBounces), not using
 * the boost, and not aiming returns. `magnet` (Sand Orb) is the share of incoming balls it goes for with the magnet.
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { reactionMs: 380, speed: 0.6, noise: 45, lapse: 0.3, maxBounces: 1, horizon: 2, gain: 6, aim: 0, smash: 0, smashSave: 0, magnet: 0.3, magnetHold: 0.8 },
  normal: { reactionMs: 220, speed: 0.8, noise: 22, lapse: 0.1, maxBounces: 2, horizon: 3, gain: 8, aim: 0.2, smashDist: 0.3, smashSave: 1, magnet: 0.6, magnetHold: 1.2 },
  hard: { reactionMs: 110, speed: 0.95, noise: 10, lapse: 0.03, maxBounces: 3, gain: 10, aim: 0.5, smashDist: 0.5, magnet: 0.85 },
  expert: { reactionMs: 50, speed: 1, noise: 3, lapse: 0, maxBounces: 5, aim: 0.8, smashDist: 0.55 },
  semigod: { reactionMs: 0, speed: 1, noise: 0, lapse: 0, maxBounces: 99, aim: 1, aimMax: 0.8, aimSlack: 0.25, smashDist: 0.6 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
