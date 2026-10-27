/**
 * Difficulty presets, weakest to strongest. Each one overrides DEFAULT_PARAMS (full strength) in params.ts.
 * First guesses: calibrate them with bot/scenarios/ladder-rumble-cards.json and `npm run bot:analyze` (/bot-tune).
 *
 * A weaker player thinks longer, makes random plays, does not sequence its turn or value Defense. The deal decides
 * much of a round: even semigod beats a player of random cards only about 70% of the time in a duel, so the ladder
 * leans on `mistake` (measure with many rounds).
 */
export const LEVELS: Record<string, Record<string, number>> = {
  easy: { thinkMs: 2200, mistake: 0.6, lookahead: 0, focusLeader: 0, defense: 0.2, lapse: 0.2 },
  normal: { thinkMs: 1500, mistake: 0.35, lookahead: 0, focusLeader: 0.1, defense: 0.5, lapse: 0.1 },
  hard: { thinkMs: 1000, mistake: 0.15, lookahead: 1, focusLeader: 0.2, defense: 0.8, lapse: 0.03 },
  expert: { thinkMs: 650, mistake: 0.05, lookahead: 1, focusLeader: 0.3, defense: 1, lapse: 0 },
  semigod: { thinkMs: 350, mistake: 0, lookahead: 1, focusLeader: 0.3, defense: 1, lapse: 0 },
};

/** weakest to strongest */
export const LEVEL_ORDER = Object.keys(LEVELS);
