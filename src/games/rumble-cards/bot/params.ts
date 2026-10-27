/** Tunable numbers of the planner policy (full strength). Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** ms it thinks before each play (a person reads the table first); it hurries when the turn timer runs low */
  thinkMs: 350,
  /** 0..1 chance a play is a random legal card and target instead of the best */
  mistake: 0,
  /** 1 = plans the turn: extra-play cards first, finishing blows, Defense against what is coming; 0 = the timeout's simple pick */
  lookahead: 1,
  /** 1 = plays extra-play cards before anything else (they cost no play) */
  extraFirst: 1,
  /** 0..1: how much it prefers hitting the rival with the most hit points (the leader) over the weakest */
  focusLeader: 0.3,
  /** 0..1: how much it values Defense and heals against the damage it expects before its next turn */
  defense: 1,
  /** attention lapses per second: it stops for 300-600 ms */
  lapse: 0,
};
