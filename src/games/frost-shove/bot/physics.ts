// What the bot knows of the bears' motion: the server's own constants (imported, so the two cannot drift) and a cheap
// forward step for one bear. Snapshots carry no velocities; world.ts estimates them.
import { smoothstep } from '../../../core/shared/kit/util';
import { polarEdge } from '../shared/geometry';
import { ACCEL, BOLT_HALF, BOLT_ON, BOLT_WARN, BOMB_BLAST, DASH_SPEED, DASH_TIME, FRICTION, MAX_SPEED, MIN_RADIUS, START_RADIUS } from '../server/FrostShove';

export { ACCEL, BOLT_HALF, BOLT_ON, BOLT_WARN, BOMB_BLAST, DASH_SPEED, DASH_TIME, FRICTION, MAX_SPEED };
export { BASE_R, BOMB_LIFE, BOMB_SPEED, DASH_COST } from '../server/FrostShove';

export { LEDGE_SPEED, MIN_RADIUS, WALL_BREAK_SPEED, WALL_SLICES } from '../server/FrostShove';
import { WALL_SLICES } from '../server/FrostShove';

export const C = 500;
/** distance a dash covers before friction is back (the speed is clamped to MAX_SPEED right after) */
export const DASH_REACH = DASH_SPEED * DASH_TIME;
/** roughly how far a dash hit sends an equal bear (stun-time slide at ~1000 px/s plus the braking); used for "is my back to the edge" */
export const KNOCK = 210;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** acceleration of a bear with its effect, and the tilt push (px/s^2) every bear gets */
export interface Move {
  accel: number;
  max: number;
  tx: number;
  ty: number;
}

export function moveOf(fx: string, tx = 0, ty = 0): Move {
  const k = fx === 'speed' ? 1.3 : 1;
  const m = fx === 'speed' ? 1.35 : 1;
  return { accel: fx === 'freeze' ? 0 : ACCEL * k, max: MAX_SPEED * m, tx, ty };
}

/** One tick of a bear steering with (mx, my), as the server does it (no dash, no stun). Mutates `b`. */
export function step(b: Body, mx: number, my: number, dt: number, m: Move): void {
  b.vx += (m.tx + mx * m.accel) * dt;
  b.vy += (m.ty + my * m.accel) * dt;
  const damp = Math.exp(-FRICTION * dt);
  b.vx *= damp;
  b.vy *= damp;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > m.max) {
    b.vx = (b.vx / sp) * m.max;
    b.vy = (b.vy / sp) * m.max;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/** where a bear that stops steering is after `t` s (friction only) */
export function coast(b: Body, t: number): { x: number; y: number } {
  const k = (1 - Math.exp(-FRICTION * t)) / FRICTION;
  return { x: b.x + b.vx * k, y: b.y + b.vy * k };
}

/** global ice radius at game time t of a round of `limit` s: it shrinks over the second half */
export function globalRadius(t: number, limit: number): number {
  return START_RADIUS - (START_RADIUS - MIN_RADIUS) * smoothstep((t - limit * 0.5) / (limit * 0.5));
}

/** ice left under a bear of radius r at (x, y): it falls in below 0 (the server lets 0.35 r hang over) */
export function margin(sectors: readonly number[], x: number, y: number, r: number): number {
  const dx = x - C;
  const dy = y - C;
  return polarEdge(sectors, Math.atan2(dy, dx)) + r * 0.35 - Math.hypot(dx, dy);
}

/** extra push (px) a rival needs to get through an intact slice of the wall: it stops walkers and eats part of a dash */
export const WALL_COST = 120;

/** whether an intact slice of the wall stands at (x, y); `mask` is the snapshot's `wall` (0 = no wall) */
export function wallUp(mask: number, x: number, y: number): boolean {
  if (!mask) return false;
  const a = Math.atan2(y - C, x - C);
  const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / WALL_SLICES)) % WALL_SLICES;
  return (mask & (1 << i)) !== 0;
}

/** distance from (x, y) along the unit direction (ux, uy) to the edge, up to `max` (15 px steps); an intact wall slice adds WALL_COST */
export function rayToEdge(sectors: readonly number[], x: number, y: number, ux: number, uy: number, r: number, max: number, wall = 0): number {
  for (let d = 0; d < max; d += 15) {
    if (margin(sectors, x + ux * d, y + uy * d, r) < 0) return wallUp(wall, x + ux * d, y + uy * d) ? Math.min(max, d + WALL_COST) : d;
  }
  return max;
}

/** signed distance of (x, y) from a bolt line (direction a, offset d from the centre) */
export function boltSide(a: number, d: number, x: number, y: number): number {
  return -(x - C) * Math.sin(a) + (y - C) * Math.cos(a) - d;
}
