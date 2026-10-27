/** Tunable numbers of the tactician policy (full strength). Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** the policy sees the arena this many ms late (its own tank it always knows) */
  reactionMs: 0,
  /** attention lapses per second: it keeps driving the way it was, firing nothing */
  lapse: 0,
  /** radians of random aim error */
  aimNoise: 0,
  /** 0..1: how much of a rival's motion it leads its shots by */
  lead: 1,
  /** 0..1: how much it steers out of the way of shots */
  dodge: 1,
  /** 0..1: how much it keeps out of mines, bombs and the totem */
  hazards: 1,
  /** 0..1: how readily it turns to fire (and how close it stands) instead of the safest move */
  aggression: 1,
  /** steps of 0.12 s an aiming detour is charged for (1..5: lower = turns to fire more readily) */
  aimStep: 3,
  /** 0..1: 1 = only fires when aimed; lower = also fires when the way it drives roughly points at a rival */
  fireDiscipline: 1,
  /** 0..1: how much it goes for and uses items (fruit, bombs, missiles) */
  items: 1,
  /** 0..1: chance it drops a mine when a rival is close behind */
  mines: 0.7,
  /** 0..1: Swamp Fox: how early it raises the shield against a shot (0 = never) */
  shield: 1,
};
