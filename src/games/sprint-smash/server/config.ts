import type { OptionValue } from '../../../core/shared/catalog';

/** Everything a Sprint Smash variant can tune. Numbers here are host-configurable options. */
export interface DashConfig {
  /** s a player cannot be hurt again after a hit (0 = off) */
  invulnTime: number;
  variant: string;
  /** laps to finish */
  laps: number;
  timeLimit: number; // s
  fruitEvery: number; // s between berry
  fruitVariance: number; // s, +- on fruitEvery
  fruitMax: number; // berries on the track at once
  energyDrain: number; // gauge per second while accelerating
  /** Dot Sprint / Ember Sprint: missiles */
  missiles: boolean;
  missileEvery: number; // s
  missileVariance: number; // s, +- on missileEvery
  missileMax: number; // missile pick-ups on the track at once
  /** Ember Sprint: volcano with lava patches */
  volcano: boolean;
  eruptEvery: number; // s
  eruptVariance: number; // s, +- on eruptEvery
  /** Toxic Sprint: barrels, slime monster, force fields */
  toxic: boolean;
  slimeEvery: number; // s
  slimeVariance: number; // s, +- on slimeEvery
  starEvery: number; // s
  starVariance: number; // s, +- on starEvery
  starMax: number; // force fields on the track at once
  /** Splash Sprint: turning rods and jumping */
  rods: boolean;
  rodSpeed: number; // rad/s, the hub turns against the lap direction
  rodEvery: number; // s between two hub events (tubes leaving)
  rodVariance: number; // s, +- on rodEvery
  rodBurst: number; // % chance that an event starts a sequence of quicker events
  /** Dot Sprint: open track edges (only the top outer arc is a wall); leaving the track costs `fallPenalty` */
  edgeWalls: boolean;
  /** with edgeWalls: the top outer arc (10 to 2 o'clock) is still a wall (Dot Sprint); false = the whole outer edge is open (Toxic Sprint) */
  outerArc: boolean;
  fallPenalty: number; // s frozen after a fall
  fallPenaltyVariance: number; // s, +- on fallPenalty
  /** Dot Sprint: s a craft crawls after a hit (0 = off) */
  hitSlow: number;
  hitSlowVariance: number; // s, +- on hitSlow
  /** Dot Sprint: berries load a bar that holding the action button burns for speed; no passive speed-up */
  berryBar: boolean;
  /** Dot Sprint: missiles fly straight from the craft, bounce on the wall and are fired with a2 */
  straightMissiles: boolean;
  /** Dot / Toxic Sprint: held items (missile, force field) are used with a2; a1 is only the throttle */
  item2: boolean;
}

export const DASH_DEFAULTS: DashConfig = {
  invulnTime: 0.5,
  variant: 'dot-sprint',
  laps: 10,
  timeLimit: 120,
  fruitEvery: 5,
  fruitVariance: 0,
  fruitMax: 4,
  energyDrain: 0.4,
  missiles: false,
  missileEvery: 6,
  missileVariance: 0,
  missileMax: 3,
  volcano: false,
  eruptEvery: 12,
  eruptVariance: 0,
  toxic: false,
  slimeEvery: 14,
  slimeVariance: 0,
  starEvery: 10,
  starVariance: 0,
  starMax: 2,
  rods: false,
  rodSpeed: 0.3,
  rodEvery: 12,
  rodVariance: 0,
  rodBurst: 25,
  edgeWalls: false,
  outerArc: false,
  fallPenalty: 2,
  fallPenaltyVariance: 0,
  hitSlow: 0,
  hitSlowVariance: 0,
  berryBar: false,
  straightMissiles: false,
  item2: false,
};

export interface DashVariant {
  id: string;
  name: string;
  config: DashConfig;
}

export const DASH_VARIANTS: DashVariant[] = [
  { id: 'dot-sprint', name: 'Dot Sprint', config: { ...DASH_DEFAULTS, missiles: true, edgeWalls: true, outerArc: true, hitSlow: 3, berryBar: true, straightMissiles: true, item2: true } },
  { id: 'toxic-sprint', name: 'Toxic Sprint', config: { ...DASH_DEFAULTS, variant: 'toxic-sprint', toxic: true, edgeWalls: true, berryBar: true, item2: true } },
  { id: 'ember-sprint', name: "Ember Sprint", config: { ...DASH_DEFAULTS, variant: 'ember-sprint', missiles: true, volcano: true, edgeWalls: true, hitSlow: 3, berryBar: true, straightMissiles: true, item2: true } },
  { id: 'splash-sprint', name: 'Splash Sprint', config: { ...DASH_DEFAULTS, variant: 'splash-sprint', rods: true, edgeWalls: true, hitSlow: 3, berryBar: true, item2: true } },
];

/** Overlay validated host options (numbers only; unknown ids are ignored). */
export function applyOptions(v: DashVariant, options: Record<string, OptionValue>): DashConfig {
  const cfg: Record<string, unknown> = { ...v.config };
  for (const [k, val] of Object.entries(options)) {
    if (k !== 'variant' && typeof val === 'number' && typeof cfg[k] === 'number') cfg[k] = val;
  }
  return cfg as unknown as DashConfig;
}
