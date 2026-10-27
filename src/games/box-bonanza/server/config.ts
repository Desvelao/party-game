import type { OptionValue } from '../../../core/shared/catalog';

/** Everything a Box Bonanza variant can tune. Numbers are host-configurable options. */
export interface CrateConfig {
  /** s a player cannot be hurt again after a hit (0 = off) */
  invulnTime: number;
  variant: string;
  timeLimit: number; // s
  maxHp: number;
  crateEvery: number; // s between crate drops
  crateVariance: number; // s, +- on crateEvery
  berryEvery: number; // s between healing berries
  berryVariance: number; // s, +- on berryEvery
  blastRadius: number; // TNT, world units
  tntFuse: number; // s from picked up / thrown / kicked until a TNT crate explodes
  tntDamage: number; // hp lost by a player inside a TNT blast
  weightTime: number; // s the weight carrier has before it kills them (unless passed on)
  powerupEvery: number; // s
  powerupVariance: number; // s, +- on powerupEvery
  penguinTime: number; // s the penguin spins
  boxEvery: number; // s between ? crate sets
  boxVariance: number; // s, +- on boxEvery
  pickupRange: number; // px: reach of the pick-up
  pickupCooldown: number; // s after picking up or throwing a crate
  kickRange: number; // px: reach of the kick
  kickCooldown: number; // s between kicks
  /** resting crates (all but nitro) block players; nitro still explodes on touch */
  solidCrates: boolean;
  /** explosions destroy floor tiles, falling in a hole eliminates */
  floorHoles: boolean;
  /** icy floor: low grip */
  slippery: boolean;
  penguin: boolean;
  /** mask / boots / Z / weight pick-ups */
  powerups: boolean;
  nitro: boolean;
  /** locked crates (weak) instead of blocks */
  lockedCrates: boolean;
  /** sets of ? crates with berry and weapons */
  qboxes: boolean;
}

export const CRATE_DEFAULTS: CrateConfig = {
  invulnTime: 0.5,
  variant: 'jungle-bonanza',
  timeLimit: 90,
  maxHp: 10,
  crateEvery: 4,
  crateVariance: 0,
  berryEvery: 7,
  berryVariance: 0,
  blastRadius: 130,
  tntFuse: 3,
  tntDamage: 4,
  weightTime: 5,
  powerupEvery: 9,
  powerupVariance: 0,
  penguinTime: 8,
  boxEvery: 12,
  boxVariance: 0,
  pickupRange: 62,
  pickupCooldown: 0,
  kickRange: 74,
  kickCooldown: 0.55,
  solidCrates: true,
  floorHoles: false,
  slippery: false,
  penguin: false,
  powerups: false,
  nitro: true,
  lockedCrates: false,
  qboxes: false,
};

export interface CrateVariant {
  id: string;
  name: string;
  config: CrateConfig;
}

export const CRATE_VARIANTS: CrateVariant[] = [
  { id: 'jungle-bonanza', name: 'Jungle Bonanza', config: { ...CRATE_DEFAULTS } },
  { id: 'space-bonanza', name: 'Space Bonanza', config: { ...CRATE_DEFAULTS, variant: 'space-bonanza', floorHoles: true, powerups: true } },
  { id: 'snow-bonanza', name: 'Snow Bonanza', config: { ...CRATE_DEFAULTS, variant: 'snow-bonanza', slippery: true, penguin: true, powerups: true } },
  { id: 'drain-bonanza', name: 'Drain Bonanza', config: { ...CRATE_DEFAULTS, variant: 'drain-bonanza', nitro: false, lockedCrates: true, qboxes: true } },
];

/** Overlay validated host options (numbers and booleans; unknown ids are ignored). */
export function applyOptions(v: CrateVariant, options: Record<string, OptionValue>): CrateConfig {
  const cfg: Record<string, unknown> = { ...v.config };
  for (const [k, val] of Object.entries(options)) {
    if (k !== 'variant' && typeof val === typeof cfg[k] && (typeof val === 'number' || typeof val === 'boolean')) cfg[k] = val;
  }
  return cfg as unknown as CrateConfig;
}
