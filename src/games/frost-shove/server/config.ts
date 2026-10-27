import type { OptionValue } from '../../../core/shared/catalog';

/** Everything a Frost Shove variant can tune. Numbers here are host-configurable options. */
export interface PolarConfig {
  /** s a player cannot be hurt again after a hit (0 = off) */
  invulnTime: number;
  variant: string;
  timeLimit: number; // s
  staminaRegen: number; // bar per second
  itemEvery: number; // s between power-up beams
  itemVariance: number; // s, +- on itemEvery
  /** Frost Frenzy */
  beam: boolean;
  boltEvery: number; // s
  boltVariance: number; // s, +- on boltEvery
  maxBolts: number; // bolts falling at once
  /** Tip Tumble */
  tilt: boolean;
  tiltStrength: number; // accel at full tilt
  /** Tip Tumble: a fish jumps onto the ice and a walrus comes to catch it, its weight tipping the floe */
  walrus: boolean;
  walrusEvery: number; // s between visits
  walrusVariance: number; // +/- s around that
  /** Thaw Frenzy */
  melt: boolean;
  meltEvery: number; // s between melt events
  meltVariance: number; // +/- s around that
  meltDepth: number; // px the rim is bitten back
  badItemsOnly: boolean;
  /** Frost Classic: boxes hold only the original's beam items: grow, shrink, Lightning, Weight */
  beamItems: boolean;
  /** Frost Classic: a wall of ice slices on the rim */
  wall: boolean;
  /** Wild Frenzy */
  bombs: boolean;
  bombEvery: number; // s
  bombVariance: number; // s, +- on bombEvery
}

export const POLAR_DEFAULTS: PolarConfig = {
  invulnTime: 0.5,
  variant: 'frost-classic',
  timeLimit: 90,
  staminaRegen: 0.35,
  itemEvery: 15,
  itemVariance: 0,
  beam: false,
  boltEvery: 2.5,
  boltVariance: 0.75, // = the old fixed 0.7-1.3x spread
  maxBolts: 3,
  tilt: false,
  tiltStrength: 320,
  walrus: false,
  walrusEvery: 25,
  walrusVariance: 10,
  melt: false,
  meltEvery: 10,
  meltVariance: 4,
  meltDepth: 60,
  badItemsOnly: false,
  beamItems: false,
  wall: false,
  bombs: false,
  bombEvery: 6,
  bombVariance: 0,
};

export interface PolarVariant {
  id: string;
  name: string;
  config: PolarConfig;
}

export const POLAR_VARIANTS: PolarVariant[] = [
  { id: 'frost-classic', name: 'Frost Classic', config: { ...POLAR_DEFAULTS, beamItems: true, wall: true } },
  { id: 'frost-frenzy', name: 'Frost Frenzy', config: { ...POLAR_DEFAULTS, variant: 'frost-frenzy', beam: true } },
  { id: 'tip-tumble', name: 'Tip Tumble', config: { ...POLAR_DEFAULTS, variant: 'tip-tumble', tilt: true, walrus: true } },
  { id: 'thaw-frenzy', name: 'Thaw Frenzy', config: { ...POLAR_DEFAULTS, variant: 'thaw-frenzy', melt: true, badItemsOnly: true } },
  { id: 'wild-frenzy', name: 'Wild Frenzy', config: { ...POLAR_DEFAULTS, variant: 'wild-frenzy', bombs: true } },
];

/** Overlay validated host options (numbers only; unknown ids are ignored). */
export function applyOptions(v: PolarVariant, options: Record<string, OptionValue>): PolarConfig {
  const cfg: Record<string, unknown> = { ...v.config };
  for (const [k, val] of Object.entries(options)) {
    if (k !== 'variant' && typeof val === 'number' && typeof cfg[k] === 'number') cfg[k] = val;
  }
  return cfg as unknown as PolarConfig;
}
