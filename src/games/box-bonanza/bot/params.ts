/** Tunable numbers of the brawler policy (full strength). Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** the policy sees the arena this many ms late (its own position it always knows) */
  reactionMs: 0,
  /** attention lapses per second: it keeps the stick as it was and presses nothing */
  lapse: 0,
  /** radians of random error in its throws */
  aimNoise: 0,
  /** 0..1: how much of a rival's motion it leads a throw by */
  lead: 1,
  /** 0..1: how much it steers out of flying crates, blasts, shots and the penguin */
  dodge: 1,
  /** 0..1: how readily it goes for crates and rivals (0 = mostly keeps away) */
  aggression: 1,
  /** 0..1: how well it uses the kick (on rivals in reach, and to send crates at them) */
  kick: 1,
  /** 0..1: how much it goes for heals, good power-ups and ? crates, and keeps off bad ones */
  items: 1,
  /** 0..1: how well it uses a weapon (ring close up, missiles in a crowd, the homing orb anywhere) */
  weapons: 1,
  /** 1 = know the rules of the variant being played (holes, ice, the penguin, ? crates); 0 = play every variant as Jungle Bonanza */
  variantAware: 1,
};
