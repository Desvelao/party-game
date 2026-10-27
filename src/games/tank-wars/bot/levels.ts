/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with bot/scenarios/ladder-<variant>.json and `npm run bot:analyze` (/bot-tune).
 *
 * A weaker tank reacts late, aims badly and without lead, drives into shots and blasts, fires loosely and forgets
 * its items and its shield.
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { reactionMs: 420, lapse: 0.3, aimNoise: 0.4, lead: 0, dodge: 0, hazards: 0.2, aggression: 0.3, fireDiscipline: 0.3, items: 0.3, mines: 0.1, shield: 0 },
  normal: { reactionMs: 260, lapse: 0.12, aimNoise: 0.16, lead: 0.6, dodge: 0.55, hazards: 0.5, aggression: 0.6, fireDiscipline: 0.6, items: 0.6, mines: 0.3, shield: 0.3 },
  hard: { reactionMs: 150, lapse: 0.04, aimNoise: 0.08, lead: 0.8, dodge: 0.8, hazards: 0.85, aggression: 0.8, fireDiscipline: 0.85, items: 0.85, mines: 0.5, shield: 0.7 },
  expert: { reactionMs: 70, lapse: 0, aimNoise: 0.03, lead: 1, dodge: 1, hazards: 1, aggression: 0.9, fireDiscipline: 1, items: 1, mines: 0.6, shield: 1 },
  semigod: { reactionMs: 0, lapse: 0, aimNoise: 0, lead: 1, dodge: 1, hazards: 1, aggression: 1, fireDiscipline: 1, items: 1, mines: 0.7, shield: 1 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
