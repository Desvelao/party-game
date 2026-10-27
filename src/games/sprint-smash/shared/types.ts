// State of Sprint Smash as sent to clients. Plain `type`s so they are assignable to the core's ExternalState.

export type DashPlayerState = {
  id: string;
  x: number;
  y: number;
  /** heading, radians */
  f: number;
  /** progress in laps (fractional) */
  p: number;
  /** energy gauge 0..1 */
  e: number;
  /** held item */
  item: '' | 'missile' | 'star';
  /** jump progress 0..1, 0 = on the ground (Splash Sprint) */
  air: number;
  stun: boolean;
  /** fallen off the track, waiting to be put back (Dot Sprint) */
  fall: boolean;
  /** crawling after a hit (Dot Sprint) */
  slow: boolean;
  boost: boolean;
  /** hit protection active (flicker) */
  inv: boolean;
  /** finished all laps */
  fin: boolean;
};

/** Sprint Smash family (Dot / Toxic / Ember / Splash Sprint). Arena geometry is in dash-geometry.ts. */
export type DashState = {
  kind: 'ext:sprint-smash';
  variant: string;
  t: number;
  /** round length, s */
  limit: number;
  /** laps to finish */
  laps: number;
  players: DashPlayerState[];
  pickups: { id: number; x: number; y: number; k: 'fruit' | 'missile' | 'star' }[];
  /** straight missiles also carry their velocity */
  missiles: { id: number; x: number; y: number; a: number; vx?: number; vy?: number }[];
  /** Toxic Sprint: barrels on the edge (on = not exploded) */
  barrels?: { x: number; y: number; on: boolean }[];
  /** Toxic Sprint: slime monster visibility 0..1 and its flying blobs */
  slime?: { t: number };
  blobs?: { id: number; x: number; y: number }[];
  /** Ember Sprint: eruption warning 1 -> 0 (0 = quiet) and the lava balls the volcano throws (with their velocity) */
  volcano?: { warn: number };
  balls?: { id: number; x: number; y: number; vx: number; vy: number }[];
  /** Splash Sprint: hub angle and how far out each of its 6 tubes is, 0..1 (tube k points at a + k * 60 deg) */
  rods?: { a: number; tubes: number[] };
};
