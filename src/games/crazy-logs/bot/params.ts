/** Tunable numbers of the hopper policy (full strength). Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** the policy sees the river (spins, jets, other players) this many ms late; its own position it always knows */
  reactionMs: 0,
  /** attention lapses per second: it stands still for 300-600 ms */
  lapse: 0,
  /** cap on the walking stick (1 = full walk speed) */
  speed: 1,
  /** px of random error in where a hop lands (along the river) */
  noise: 0,
  /** 0..1: how much of a log's spin it cancels with where it lands (0 = always aims at the middle) */
  spinAware: 1,
  /** 0..1: chance it notices a water jet warning (and keeps its landing and its feet out of it) */
  jetAware: 1,
  /** px it keeps from the log ends and from the edge of the log it stands on */
  edgeMargin: 10,
  /** s it waits after the hop is ready before hopping (a person is not frame-perfect) */
  hesitate: 0,
  /** 0..1: how much it avoids landing on another player (they shove) */
  crowd: 1,
};
