// What differs between Frost Shove variants, from the bot's point of view. Perception, prediction and the sumo policy
// are shared (Frost Shove itself is the baseline); a variant only adds numbers the snapshot does not carry, and an
// optional `refine` step for the variant's own action on top of the shared decision.
import type { Decision } from '../policy/types';
import type { World } from '../world';

/** Server constants of a variant that snapshots do not show (defaults of server/config.ts; hosts may change them). */
export interface Physics {
  /** Tip Tumble: push at full tilt, px/s^2 (option tiltStrength) */
  tiltStrength?: number;
  /** Thaw Frenzy: px a melt event bites off the rim (option meltDepth) */
  meltDepth?: number;
  /** Thaw Frenzy: the beam only gives bad power-ups */
  badBeam?: boolean;
  /** the variant has bolts / bombs to dodge (they are in the snapshot; this says whether to read them) */
  bolts?: boolean;
  bombs?: boolean;
  /** Frost Classic: the snapshot's `wall` mask says which rim slices still stand */
  wall?: boolean;
}

export interface VariantAdapter {
  /** adjust the shared decision: steer, throw, set `press` */
  refine?(w: World, d: Decision, P: Record<string, number>, nowMs: number, rng: () => number): void;
}
