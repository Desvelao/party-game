// What differs between Ballistix variants, from the bot's point of view. The perception, projection and
// policy are shared (smash ball is the baseline); a variant only adds numbers the snapshot does not carry,
// and an optional `refine` step that adds the variant's own action on top of the shared decision.
import type { Decision } from '../policy/types';
import type { World } from '../world';

/** Server constants of a variant that snapshots do not show (they are tuned in server/variants/*). */
export interface Physics {
  /** ball speed decay, 1/s */
  drag?: number;
  /** speed floor / ceiling the server clamps free balls to, px/s */
  vmin?: number;
  vmax?: number;
  /** ceiling of a fully boosted (smashed) ball */
  vmaxSmash?: number;
  /** engine failure: pull strength (px/s^2) and the seconds of the warning and failing phases */
  pullAccel?: number;
  engineWarn?: number;
  engineFail?: number;
  /** repulsion power-up: push strength (px/s^2 at the paddle) and how long it lasts, s */
  repelForce?: number;
  repelDuration?: number;
}

export interface VariantAdapter {
  /** button of the boost pulse (a1 unless the variant gives it away) */
  readonly boostButton: 'a1' | 'a2';
  /** adjust the shared decision: steer, set `hold` (button a1 held) */
  refine?(w: World, d: Decision, P: Record<string, number>, nowMs: number, rng: () => number): void;
}
