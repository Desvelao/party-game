/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with bot/scenarios/ladder-<variant>.json and `npm run bot:analyze` (/bot-tune).
 *
 * A weaker brawler reacts late, throws wide and without lead, walks into blasts and flying crates, forgets the kick
 * and its items.
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { reactionMs: 500, lapse: 0.3, aimNoise: 0.5, lead: 0, dodge: 0.05, aggression: 0.4, kick: 0.2, items: 0.3, weapons: 0.3 },
  normal: { reactionMs: 260, lapse: 0.12, aimNoise: 0.18, lead: 0.4, dodge: 0.45, aggression: 0.6, kick: 0.5, items: 0.6, weapons: 0.6 },
  hard: { reactionMs: 150, lapse: 0.04, aimNoise: 0.08, lead: 0.8, dodge: 0.8, aggression: 0.8, kick: 0.8, items: 0.85, weapons: 0.85 },
  expert: { reactionMs: 70, lapse: 0, aimNoise: 0.03, lead: 1, dodge: 1, aggression: 0.9, kick: 1, items: 1, weapons: 1 },
  semigod: { reactionMs: 0, lapse: 0, aimNoise: 0, lead: 1, dodge: 1, aggression: 1, kick: 1, items: 1, weapons: 1 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
