import type { InputState } from '../../../../core/shared/types';

/** A player's paddle. Variant-specific paddle state lives inside the variant module. */
export interface Paddle {
  id: string;
  side: number;
  pos: number;
  vel: number;
  len: number;
  laneL: number;
  laneR: number;
  alive: boolean;
  /** boost pulse: cooldown left, visual time left, and whether the button was down last tick */
  smashCd: number;
  pulseT: number;
  smashHeld: boolean;
  input: InputState;
}

export interface Side {
  used: boolean;
  alive: boolean;
  lives: number;
  conceded: number;
  elimOrder: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** position at the start of this tick's movement (for swept ball-ball tests) */
  px: number;
  py: number;
  /** seconds left charging in a corner launcher (0 = in play) */
  wait: number;
  /** corner block holding / launching this ball; -1 while in flight */
  corner: number;
  /** 1 right after a smash, easing to 0; raises the speed ceiling meanwhile */
  boost: number;
  /**
   * A variant module holds this ball (e.g. stuck to a paddle): the core skips its
   * physics and other balls bounce off it.
   */
  held: boolean;
  /**
   * Disposable balls are extras added by a variant: they vanish after a goal or
   * when `life` seconds run out, and don't count for the ball maximum.
   */
  disposable: boolean;
  life: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}
