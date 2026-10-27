/**
 * Rules shared by every Ballistix variant. A variant is this config plus an
 * optional set of modules (see variants/), nothing in here knows about them.
 */
export interface CoreConfig {
  id: string;
  name: string;
  lives: number;
  ballRadius: number;
  /** px/s at serve */
  ballSpeed: number;
  ballMaxSpeed: number;
  ballMinSpeed: number;
  /** speed multiplier per paddle hit (1 = none); resets on serve */
  hitGain: number;
  /** 1/s velocity damping */
  drag: number;
  paddleLen: number;
  /** Boost: how much faster the pulse sends balls away; the speed ceiling is derived from it. */
  smashGain: number;
  smashCooldown: number;
  /** reach (px) of the boost's repulsion pulse around the paddle */
  smashRadius: number;
  smashEnabled: boolean;
  /** which action button arms the smash (variants whose first button does something else use `a2`) */
  smashButton: 'a1' | 'a2';
  /** Round length in seconds */
  timeLimit: number;
  /** balls bounce off each other (elastic) */
  ballCollisions: boolean;
  /** simultaneous balls at the start, given the number of used sides */
  startBalls: (sides: number) => number;
  /**
   * Seconds before a (re)spawned ball is launched from a random corner:
   * delay +- variance, drawn fresh for every ball.
   */
  spawn: { delay: number; variance: number };
  /**
   * A new ball is queued in a random corner every `every` s (+- `variance`)
   * while fewer than `max` balls exist. `max` 0 = no maximum.
   */
  reinforce: { every: number; variance: number; max: number };
}

/** every ball may reach this multiple of `ballMaxSpeed`; a smashed ball up to `smashCeil` (BallArena) */
export const BALL_CEIL = 1.15;

/** speed ceiling of a freshly smashed ball, as a multiple of `ballMaxSpeed` (follows the boost multiplier) */
export const smashCeilOf = (smashGain: number): number => Math.max(BALL_CEIL, smashGain * 0.95);

/** Baseline numbers (Smashball); variants spread this and override what differs. */
export const CORE_DEFAULTS: Omit<CoreConfig, 'id' | 'name'> = {
  lives: 5,
  ballRadius: 18,
  ballSpeed: 380,
  ballMaxSpeed: 820,
  ballMinSpeed: 260,
  hitGain: 1.05,
  drag: 0,
  paddleLen: 130,
  smashGain: 1.7,
  smashCooldown: 1.4,
  smashRadius: 150,
  smashEnabled: true,
  smashButton: 'a1',
  timeLimit: 150,
  ballCollisions: true,
  startBalls: (sides) => (sides >= 3 ? 2 : 1),
  spawn: { delay: 2.5, variance: 1 },
  reinforce: { every: 15, variance: 6, max: 4 },
};
