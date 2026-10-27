import type { BallArenaState } from '../../shared/types';
import type { GameEventKind } from '../../../../core/shared/types';
import type { CoreConfig } from './config';
import type { Ball, Circle, Paddle } from './types';

/** What the core exposes to a variant module (and nothing more). */
export interface ArenaApi {
  readonly cfg: CoreConfig;
  readonly paddles: readonly Paddle[];
  readonly balls: readonly Ball[];
  /** speed ceiling of a smashed ball, as a multiple of `cfg.ballMaxSpeed` */
  readonly smashCeil: number;
  /** seeded random in [0,1) */
  rand(): number;
  emit(kind: GameEventKind, id: string, x: number, y: number): void;
  /** Add a disposable ball already in flight (vanishes on goal or after `life` s). */
  addDisposableBall(x: number, y: number, vx: number, vy: number, life: number): Ball;
  /** Send a ball back into a random corner launcher (as after a goal). */
  requeue(ball: Ball): void;
}

/**
 * A variant feature plugged into the core loop. Every hook is optional; the
 * core never knows which modules exist, a variant just lists the ones it uses.
 * Modules keep their own per-paddle / per-ball state.
 */
export interface VariantModule {
  readonly id: string;
  /** Round (re)start, after paddles exist and before the first ball spawns. */
  init?(): void;
  /** Once per tick, before paddles and balls move. */
  update?(dt: number): void;
  /** Per living paddle, after the core's smash timers and before it moves. */
  stepPaddle?(p: Paddle, dt: number): void;
  /** After all paddles have moved this tick. */
  afterPaddles?(): void;
  /** Extra force on a free ball, before drag and speed limits. */
  forceBall?(b: Ball, dt: number): void;
  /** Solid circles that balls bounce off this tick. */
  obstacles?(): Circle[];
  /** A ball reached a paddle. Return true to take it (no deflection). */
  paddleContact?(b: Ball, pad: Paddle, speed: number): boolean;
  /** A paddle left the round (disconnected / its side was eliminated). */
  paddleGone?(p: Paddle): void;
  /** Overrides the paddle's cooldown indicator (0..1, 1 = ready). */
  cooldownFraction?(p: Paddle): number | undefined;
  /** Add this module's part to the wire state. */
  extendState?(state: BallArenaState): void;
}

export type ModuleFactory = (api: ArenaApi) => VariantModule[];
