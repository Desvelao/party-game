/** Tunable numbers of the racer policy (full strength). Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** the policy sees the track this many ms late (its own craft it always knows) */
  reactionMs: 0,
  /** attention lapses per second: it keeps the stick as it was and lets go of the throttle */
  lapse: 0,
  /** 0..1: how tight it takes the racing line (1 = hugs the inner wall, the shortest lap; 0 = the middle) */
  line: 1,
  /** px of random wobble in the line it drives */
  noise: 0,
  /** 0..1 share of the time it holds the throttle (holding it always is fastest) */
  throttle: 1,
  /** 0..1: how much it steers around hazards (lava, barrels, blobs, rods, missiles) */
  dodge: 1,
  /** 0..1: how much it goes for pick-ups and uses its items well */
  items: 1,
  /** s it looks ahead along the track */
  lookahead: 1,
  /** Splash Sprint: 1 = jump over the rods (they knock you across the track and slow you) */
  jumpRods: 1,
  /** 1 = know the rules of the variant being played (rods and the jump, toxic hazards, lava); 0 = race every variant as Dot Sprint */
  variantAware: 1,
};
