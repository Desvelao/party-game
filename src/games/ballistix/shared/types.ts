// State of Ballistix as sent to clients. Plain `type`s so they are assignable to the core's ExternalState.

/**
 * Ballistix family (all variants). Paddle `pos` is the offset along its side
 * in that side's canonical frame (viewer at the bottom, +x = right); side k is
 * that frame rotated k quarter turns (0 bottom, 1 left, 2 top, 3 right).
 *
 * The first block is the core rules and is identical for every variant. Each
 * variant feature adds its own optional extension object below (present only
 * for variants that use it), so nothing variant-specific leaks into the core
 * entries.
 */
export type BallArenaState = {
  kind: 'ext:ballistix';
  variant: string;
  t: number;
  /** round length, s */
  limit: number;
  /** reach of the boost pulse in px */
  boostRadius: number;
  sides: { side: number; used: boolean; alive: boolean; lives: number; maxLives: number }[];
  paddles: { id: string; side: number; pos: number; len: number; alive: boolean; d: number; /** 1 -> 0 while the boost pulse is showing */ pulse: number }[];
  /** wait: charging inside corner block `corner` (x,y = block centre); corner is -1 in flight */
  balls: { id: number; x: number; y: number; r: number; wait: boolean; corner: number; boost: number }[];

  // ---- variant extensions ----
  /** Sand Orb: paddles grab balls with a magnet */
  magnet?: {
    /** reach in px */
    range: number;
    paddles: { id: string; pulling: boolean; held: number; /** 1 -> 0 time left, -1 when holding nothing */ holdLeft: number }[];
    /** ids of balls currently stuck to a paddle */
    held: number[];
  };
  /** Pulse Ball: the ball-bot in the middle and the balls it fired */
  enemy?: {
    phase: 'off' | 'warn' | 'on';
    angle: number;
    /** 1 -> 0 time left in the current phase */
    left: number;
    r: number;
    /** disposable balls fired by the bot; life 1 -> 0 */
    balls: { id: number; life: number }[];
  };
  /** Pulse Ball: the repulsion power-up item and who has its effect */
  repel?: {
    item: { x: number; y: number; /** 1 -> 0 before it vanishes */ life: number } | null;
    paddles: { id: string; /** 1 -> 0 time left */ left: number }[];
    radius: number;
  };
  /** Cloud Orbs: the four corner engines */
  engines?: { phase: 'ok' | 'warn' | 'fail'; left: number; pull: number }[];
};
