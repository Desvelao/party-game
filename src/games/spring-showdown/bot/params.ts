/** Tunable numbers of the planner policy (full strength). Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** the policy sees the board this many ms late; where it stands it always knows */
  reactionMs: 0,
  /** attention lapses per second: it keeps hopping the way it was, presses nothing */
  lapse: 0,
  /** hops it plans ahead (1..4) */
  depth: 4,
  /** 0..1 random error added to every tile's value (sloppy choices) */
  noise: 0,
  /** weight of banking: a crate (or a closing loop in Spring Rush) is worth this x the squares it banks */
  bank: 1.2,
  /** 0..1: how well it fires: 1 = only when a rival is lined up (and not protected); 0 = soon after picking up */
  aim: 1,
  /** 0..1: how much it values items (boots, missiles, beams, arrows, the padlock) */
  items: 1,
  /** 0..1: how much it avoids missiles in flight, lined-up rivals with a missile, TNT and mushrooms */
  hazards: 1,
  /** 1 = values closing loops (Spring Rush, Spring Madness) */
  enclose: 1,
  /** Spring Rush: squares a closing loop should bank at least (a smaller one is held back) */
  encloseMin: 10,
  /** 0..1: how carefully it keeps off its own colour where that wipes it (Spring Lock) */
  careful: 1,
  /** 1 = know the rules of the variant being played; 0 = play every variant as Spring Painter */
  variantAware: 1,
};
