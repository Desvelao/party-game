export interface CardsConfig {
  /** starting (and maximum) hit points */
  hp: number;
  /** cards drawn at the start */
  hand: number;
  /** most cards a player may keep at the end of their turn; the extra ones are discarded */
  maxHand: number;
  /** seconds a player has for their turn */
  turnSeconds: number;
  /** +- seconds of random variation of that, drawn fresh for every turn */
  turnVariance: number;
  /** turns per player after which the round ends (most hit points wins) */
  maxTurns: number;
}

export const DEFAULT_CONFIG: CardsConfig = { hp: 10, hand: 3, maxHand: 3, turnSeconds: 20, turnVariance: 0, maxTurns: 25 };

const pick = (v: unknown, def: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def;
  return Math.min(hi, Math.max(lo, n));
};

export function applyOptions(options: Record<string, number | boolean | string>): CardsConfig {
  return {
    hp: pick(options.hp, DEFAULT_CONFIG.hp, 5, 20),
    hand: pick(options.hand, DEFAULT_CONFIG.hand, 2, 5),
    maxHand: pick(options.maxHand, DEFAULT_CONFIG.maxHand, 2, 8),
    turnSeconds: pick(options.turnSeconds, DEFAULT_CONFIG.turnSeconds, 10, 60),
    turnVariance: pick(options.turnVariance, DEFAULT_CONFIG.turnVariance, 0, 8),
    maxTurns: pick(options.maxTurns, DEFAULT_CONFIG.maxTurns, 10, 40),
  };
}
