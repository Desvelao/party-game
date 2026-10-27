import type { OptionValue } from '../../../core/shared/catalog';

/** Everything a Spring Showdown variant can tune. Numbers are host-configurable options. */
export interface PogoConfig {
  /** s a player cannot be hurt again after a hit (0 = off) */
  invulnTime: number;
  variant: string;
  timeLimit: number; // s
  hopTime: number; // s per hop
  gridSize: number;
  itemEvery: number; // s between boots/missile/arrow items
  crateEvery: number; // s between crates
  itemVariance: number; // s, +- spread on itemEvery
  crateVariance: number; // s, +- spread on crateEvery
  crateCount: number; // crates that appear together
  stunTime: number; // s
  tntEvery: number; // s between Blast Bot actions
  tntVariance: number; // s, +- on tntEvery
  tntFuse: number; // s from a TNT appearing until it explodes
  tntRadius: number; // squares the blast reaches around the TNT (1 = 3x3)
  padlockTime: number; // s
  /** how banked points are earned */
  scoreBy: 'crates' | 'enclose';
  /** closing a loop fills the enclosed squares */
  fillEnclosed: boolean;
  /** missiles fly in all four directions */
  fourWayMissile: boolean;
  beam: boolean;
  arrows: 'one' | 'two' | 'none';
  mushrooms: boolean;
  bomber: boolean;
  padlock: boolean;
  /** landing on your own colour wipes all your squares */
  selfWipe: boolean;
  /** a missile hit turns all the victim's squares into the shooter's colour */
  steal: boolean;
  /** players cannot share a square: a hop onto an occupied square is blocked */
  collisions: boolean;
}

export const POGO_DEFAULTS: PogoConfig = {
  invulnTime: 0.5,
  variant: 'spring-painter',
  timeLimit: 90,
  hopTime: 0.32,
  gridSize: 8,
  itemEvery: 5,
  crateEvery: 7,
  itemVariance: 0,
  crateVariance: 0,
  crateCount: 2,
  stunTime: 2.5,
  tntEvery: 4,
  tntVariance: 0,
  tntFuse: 3,
  tntRadius: 1,
  padlockTime: 8,
  scoreBy: 'crates',
  fillEnclosed: false,
  fourWayMissile: false,
  beam: false,
  arrows: 'one',
  mushrooms: false,
  bomber: false,
  padlock: false,
  selfWipe: false,
  steal: false,
  collisions: true,
};

export interface PogoVariant {
  id: string;
  name: string;
  config: PogoConfig;
}

export const POGO_VARIANTS: PogoVariant[] = [
  { id: 'spring-painter', name: 'Spring Painter', config: { ...POGO_DEFAULTS } },
  {
    id: 'spring-rush',
    name: 'Spring Rush',
    config: { ...POGO_DEFAULTS, variant: 'spring-rush', scoreBy: 'enclose', fillEnclosed: true, fourWayMissile: true, beam: true, arrows: 'two' },
  },
  {
    id: 'spring-madness',
    name: 'Spring Madness',
    config: { ...POGO_DEFAULTS, variant: 'spring-madness', fillEnclosed: true, bomber: true },
  },
  {
    id: 'spring-lock',
    name: 'Spring Lock',
    config: { ...POGO_DEFAULTS, variant: 'spring-lock', arrows: 'none', padlock: true, selfWipe: true, steal: true },
  },
];

/** Overlay validated host options (numbers only; unknown ids are ignored). */
export function applyOptions(v: PogoVariant, options: Record<string, OptionValue>): PogoConfig {
  const cfg: Record<string, unknown> = { ...v.config };
  for (const [k, val] of Object.entries(options)) {
    if (k === 'variant') continue;
    if ((typeof val === 'number' && typeof cfg[k] === 'number') || (typeof val === 'boolean' && typeof cfg[k] === 'boolean')) cfg[k] = val;
  }
  return cfg as unknown as PogoConfig;
}
