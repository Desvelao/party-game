// What differs between Spring Showdown variants, from the bot's point of view. The planner is shared (Spring Painter
// is the baseline); a variant's rules are the server's own flags (server/config.ts), read by `rules`, plus value
// tweaks and an optional `refine` for its own action.
import type { PogoConfig } from '../../server/config';
import type { Decision } from '../policy/types';
import type { World } from '../world';

/** the variant flags the planner reads (straight from the server's variant config) */
export type Rules = Pick<PogoConfig, 'scoreBy' | 'fillEnclosed' | 'fourWayMissile' | 'beam' | 'bomber' | 'padlock' | 'selfWipe' | 'steal' | 'mushrooms'>;

export interface VariantAdapter {
  readonly rules: Rules;
  /** extra value of an item kind in this variant (added to the planner's) */
  readonly itemBonus?: Partial<Record<string, number>>;
  refine?(w: World, d: Decision, P: Record<string, number>, nowMs: number, rng: () => number): void;
}
