import type { OptionValue } from '../../../core/shared/catalog';

/** Everything a Tank Wars variant can tune. Numbers here are host-configurable options. */
export interface TankConfig {
  /** s a player cannot be hurt again after a hit (0 = off) */
  invulnTime: number;
  variant: string;
  timeLimit: number; // s
  maxHp: number;
  mines: number;
  /** everyone gets a different cannon (by seat); off = the balanced one for all */
  cannonTypes: boolean;
  fruitEvery: number; // s
  fruitVariance: number; // s, +- on fruitEvery
  mineEvery: number; // s between mine pick-ups
  mineVariance: number; // s, +- on mineEvery
  /** Desert Fox / Metal Fox: the block maze */
  /** width of the playable field in squares (see arenaBounds in geometry.ts) */
  arenaSize: number;
  maze: boolean;
  /** tanks only drive along the corridor rails and turn at crossings (original Desert / Metal Fox) */
  rails: boolean;
  /** Metal Fox */
  metalWalls: boolean;
  wallEvery: number; // s
  wallVariance: number; // s, +- on wallEvery
  bombs: boolean;
  bombEvery: number; // s
  bombVariance: number; // s, +- on bombEvery
  /** Jungle Fox */
  totem: boolean;
  totemEvery: number; // s
  totemVariance: number; // s, +- on totemEvery
  missiles: boolean;
  missileEvery: number; // s
  missileVariance: number; // s, +- on missileEvery
  /** Swamp Fox: boats, shields, no fruit, mines that trigger by contact */
  swamp: boolean;
  shieldTime: number; // s
  /** Swamp Fox: speed of the wandering contact mine, px/s */
  mineSpeed: number;
  /** Swamp Fox / Jungle Fox: the cannon shot rebounds off walls and the field edge */
  shotBounce: boolean;
  /** seconds a cannon shot flies before it vanishes */
  shotLife: number;
}

export const TANK_DEFAULTS: TankConfig = {
  invulnTime: 0.5,
  variant: 'desert-fox',
  timeLimit: 90,
  maxHp: 100,
  mines: 3,
  cannonTypes: true,
  fruitEvery: 12,
  fruitVariance: 0,
  mineEvery: 20,
  mineVariance: 0,
  arenaSize: 11,
  maze: false,
  rails: false,
  metalWalls: false,
  wallEvery: 6,
  wallVariance: 0,
  bombs: false,
  bombEvery: 14,
  bombVariance: 0,
  totem: false,
  totemEvery: 15,
  totemVariance: 0,
  missiles: false,
  missileEvery: 18,
  missileVariance: 0,
  swamp: false,
  shieldTime: 2,
  mineSpeed: 35,
  shotBounce: false,
  shotLife: 5,
};

export interface TankVariant {
  id: string;
  name: string;
  config: TankConfig;
}

export const TANK_VARIANTS: TankVariant[] = [
  { id: 'desert-fox', name: 'Desert Fox', config: { ...TANK_DEFAULTS, maze: true, rails: true } },
  { id: 'metal-fox', name: 'Metal Fox', config: { ...TANK_DEFAULTS, variant: 'metal-fox', maze: true, rails: true, metalWalls: true, bombs: true } },
  { id: 'jungle-fox', name: 'Jungle Fox', config: { ...TANK_DEFAULTS, variant: 'jungle-fox', totem: true, missiles: true, arenaSize: 8, shotBounce: true, shotLife: 3 } },
  { id: 'swamp-fox', name: 'Swamp Fox', config: { ...TANK_DEFAULTS, variant: 'swamp-fox', swamp: true, arenaSize: 8, shotBounce: true, shotLife: 3 } },
];

/** Overlay validated host options (numbers and the cannon switch; unknown ids are ignored). */
export function applyOptions(v: TankVariant, options: Record<string, OptionValue>): TankConfig {
  const cfg: Record<string, unknown> = { ...v.config };
  for (const [k, val] of Object.entries(options)) {
    if (k === 'variant') continue;
    if (typeof val === 'number' && typeof cfg[k] === 'number') cfg[k] = val;
    if (typeof val === 'boolean' && typeof cfg[k] === 'boolean') cfg[k] = val;
  }
  return cfg as unknown as TankConfig;
}
