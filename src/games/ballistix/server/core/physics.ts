import { CORNER_SIZE, fieldCorner } from '../../shared/geometry';
import { type GameEventKind } from '../../../../core/shared/types';
import { C, r1 } from './geometry';
import type { Ball, Circle } from './types';

type Emit = (kind: GameEventKind, id: string, x: number, y: number) => void;

/** Bounce a ball off a solid circle (bumpers, enemy body): reflects and adds 5 % speed. */
export function bounceCircle(b: Ball, bm: Circle, ballRadius: number, maxSpeed: number, emit: Emit): void {
  const dx = b.x - bm.x;
  const dy = b.y - bm.y;
  const min = bm.r + ballRadius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 1;
  const nx = dx / d;
  const ny = dy / d;
  b.x = bm.x + nx * min;
  b.y = bm.y + ny * min;
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) {
    b.vx -= 2 * dot * nx;
    b.vy -= 2 * dot * ny;
    const sp = Math.hypot(b.vx, b.vy);
    const target = Math.min(maxSpeed, sp * 1.05);
    b.vx *= target / sp;
    b.vy *= target / sp;
    emit('bump', '', r1(b.x), r1(b.y));
  }
}

/** Each corner is a solid quarter disc centred on the field corner (not part of any goal). */
export function bounceCorner(b: Ball, i: number, ballRadius: number): void {
  const [cx, cy] = fieldCorner(i);
  let dx = b.x - cx;
  let dy = b.y - cy;
  const reach = CORNER_SIZE + ballRadius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= reach * reach) return;
  let d = Math.sqrt(d2);
  if (d < 1e-6) {
    // exactly on the corner: push towards the field centre
    dx = C - cx;
    dy = C - cy;
    d = Math.hypot(dx, dy) || 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const push = d2 < 1e-12 ? reach : reach - d;
  b.x += nx * push;
  b.y += ny * push;
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) {
    b.vx -= 2 * dot * nx;
    b.vy -= 2 * dot * ny;
  }
}

/** Resolve overlap and exchange the normal velocity components of two equal balls. */
function bounceBalls(a: Ball, b: Ball, D: number, emit: Emit): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    dx = 1;
    dy = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  if (d < D) {
    const push = (D - d) / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    b.x += nx * push;
    b.y += ny * push;
  }
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn < 0) {
    a.vx += vn * nx;
    a.vy += vn * ny;
    b.vx -= vn * nx;
    b.vy -= vn * ny;
    if (-vn > 120) emit('bump', '', r1((a.x + b.x) / 2), r1((a.y + b.y) / 2));
  }
}

/**
 * Elastic equal-mass collisions between balls in flight (swept over the tick so
 * fast balls can't tunnel). Held balls act as immovable obstacles.
 */
export function collideBalls(balls: readonly Ball[], ballRadius: number, dt: number, emit: Emit): void {
  const D = 2 * ballRadius;
  const free = balls.filter((b) => b.wait <= 0 && !b.held);
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i];
      const b = free[j];
      const d0x = b.px - a.px;
      const d0y = b.py - a.py;
      const wx = b.x - a.x - d0x;
      const wy = b.y - a.y - d0y;
      // earliest t in [0,1] where the centres are D apart (if they start apart)
      let tHit = -1;
      const c0 = d0x * d0x + d0y * d0y - D * D;
      const A = wx * wx + wy * wy;
      if (c0 > 0 && A > 1e-9) {
        const B = 2 * (d0x * wx + d0y * wy);
        const disc = B * B - 4 * A * c0;
        if (disc >= 0) {
          const t = (-B - Math.sqrt(disc)) / (2 * A);
          if (t >= 0 && t <= 1) tHit = t;
        }
      }
      if (tHit >= 0) {
        // rewind to the moment of impact, bounce, then finish the tick
        a.x = a.px + (a.x - a.px) * tHit;
        a.y = a.py + (a.y - a.py) * tHit;
        b.x = b.px + (b.x - b.px) * tHit;
        b.y = b.py + (b.y - b.py) * tHit;
        bounceBalls(a, b, D, emit);
        const rest = (1 - tHit) * dt;
        a.x += a.vx * rest;
        a.y += a.vy * rest;
        b.x += b.vx * rest;
        b.y += b.vy * rest;
      } else {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy < D * D) bounceBalls(a, b, D, emit);
      }
    }
  }

  // held balls are fixed in place: free balls bounce off them
  for (const h of balls) {
    if (!h.held) continue;
    for (const f of free) {
      const dx = f.x - h.x;
      const dy = f.y - h.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= D * D) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = d2 > 1e-9 ? dx / d : 0;
      const ny = d2 > 1e-9 ? dy / d : -1;
      f.x = h.x + nx * D;
      f.y = h.y + ny * D;
      const dot = f.vx * nx + f.vy * ny;
      if (dot < 0) {
        f.vx -= 2 * dot * nx;
        f.vy -= 2 * dot * ny;
      }
    }
  }
}
