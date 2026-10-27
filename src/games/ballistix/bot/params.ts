/** Tunable numbers of the predictive policy. Override with --param name=value; they are written to every report. */
export const DEFAULT_PARAMS: Record<string, number> = {
  /** 0..1: how much to angle returns towards the weakest opponent (0 = always centre hit) */
  aim: 0.5,
  /** cap on the paddle-offset used for aiming (1 = paddle edge) */
  aimMax: 0.7,
  /** seconds of spare time needed before aiming is applied in full */
  aimSlack: 0.35,
  /** paddle controller gain, 1/s (stay below the paddle response of 14) */
  gain: 10,
  /** px of position error ignored */
  deadband: 2,
  /** 1 = use the smash/boost */
  smash: 1,
  /** smash offensively when a ball approaches within this fraction of the boost radius */
  smashDist: 0.55,
  /** 1 = smash to save a ball the paddle cannot reach */
  smashSave: 1,
  /** seconds to look ahead for impacts */
  horizon: 3.5,
  /** 0..1: with no threat, drift towards this fraction of the balls' mean lateral position */
  idleFollow: 0.3,
  /** px of random target error (simulates a human, 0 = perfect) */
  noise: 0,
  /** the policy sees the world this many ms late (human reaction time) */
  reactionMs: 0,
  /** cap on |mx|: top paddle speed as a fraction of the maximum */
  speed: 1,
  /** attention lapses per second: the paddle freezes for 300-600 ms and nothing is pressed */
  lapse: 0,
  /** balls that will bounce more than this many times before reaching the goal are not predicted */
  maxBounces: 99,
  /** compensate snapshot age by extrapolating (seconds cap) */
  maxAge: 0.12,
  /** 1 = know the rules of the variant being played (drag, pulls); 0 = play every variant as smash ball */
  variantAware: 1,
  /** Sand Orb: share of incoming balls the bot goes for with the magnet (0 = never) */
  magnet: 1,
  /** Sand Orb: seconds to hold a caught ball while aiming, at most (the server drops it at 3) */
  magnetHold: 1.6,
};
