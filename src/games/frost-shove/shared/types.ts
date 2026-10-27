// State of Frost Shove as sent to clients. Plain `type`s so they are assignable to the core's ExternalState.

export type PolarPlayerState = {
  id: string;
  x: number;
  y: number;
  /** facing angle, radians */
  f: number;
  /** on the ice (false = eliminated) */
  alive: boolean;
  /** hit protection active (flicker) */
  inv: boolean;
  /** stamina 0..1 (a dash needs 0.5) */
  st: number;
  /** body radius (power-ups grow/shrink it) */
  r: number;
  /** active effect: '' | speed | giant | shrink | freeze | dismounted */
  fx: string;
  /** effect time left, 1 -> 0 */
  fxl: number;
  /** Lightning or Weight in hand ('' = none) and its countdown, 1 -> 0 */
  carry: string;
  carryl: number;
  /** seconds left stunned (Lightning 6, dismounted 1.2, dash hits 0.2) */
  stun: number;
  /** time left to climb back while hanging on the edge, 1 -> 0 (0 on the ice; cosmetic: how deep the bear has sunk) */
  drown: number;
  /** 0 = on the ice, otherwise 0..1 climb-back progress while in the water */
  fall: number;
  /** carrying a bomb (Wild Frenzy) */
  bomb: boolean;
  /** bomb hits taken (Wild Frenzy) */
  hits: number;
};

/** Frost Shove family. `sectors` = ice radius at evenly spaced angles (see polarEdge). */
export type FrostShoveState = {
  kind: 'ext:frost-shove';
  variant: string;
  t: number;
  /** round length, s */
  limit: number;
  sectors: number[];
  /** Tip Tumble: normalised tilt, magnitude 0..1 (0,0 elsewhere) */
  tilt: { x: number; y: number };
  players: PolarPlayerState[];
  /** pick-ups on the ice: bombs (Wild Frenzy) */
  items: { id: number; x: number; y: number; k: 'bomb' }[];
  /** the power-up dispenser (a robot, Gruff in Thaw Frenzy): where it hovers, and the beam spot under it once flying in; k = progress of the phase 0..1 */
  beam?: { who: 'robot' | 'warden'; ph: 'idle' | 'fly' | 'aim' | 'on' | 'melt' | 'back'; x: number; y: number; sx: number; sy: number; r: number; k: number };
  /** Thaw Frenzy: bites about to melt out of the rim: sector and progress of the warning 0..1 */
  melts?: { i: number; k: number }[];
  /** Frost Frenzy: energy bolts. a = direction, d = offset of the line from the centre, warn 1 -> 0 */
  bolts?: { a: number; d: number; warn: number; on: boolean }[];
  /** Tip Tumble: the walrus visit in progress: phase, angle from the centre, radial distance of the fish/walrus, progress of the phase 0..1 */
  walrus?: { ph: 'fish' | 'in' | 'eat' | 'out'; a: number; r: number; k: number };
  /** Frost Classic: bitmask of the ice slices still standing on the rim (bit i = sector i) */
  wall?: number;
  /** Wild Frenzy: thrown bombs in flight */
  flying?: { id: number; x: number; y: number }[];
};
