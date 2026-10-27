import type { World } from '../world';

export interface Threat {
  id: number;
  /** seconds until the ball reaches our paddle plane */
  t: number;
  /** where (lateral) */
  x: number;
  /** time to spare after the paddle has travelled there (negative = cannot make it) */
  slack: number;
  bounces: number;
}

export interface Decision {
  /** paddle command -1..1 */
  mx: number;
  /** wants the boost pulse now */
  smash: boolean;
  /** variant action held on a1 (Sand Orb's magnet) */
  hold?: boolean;
  threats: Threat[];
  chosen: number | null;
  target: number;
  info: Record<string, unknown>;
}

export interface Policy {
  decide(w: World, nowMs: number): Decision;
}
