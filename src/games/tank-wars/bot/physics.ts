// What the bot knows of Tank Wars: the server's own constants (imported, so the two cannot drift), the arena's
// solids, a copy of the movement rules (free driving and rails), line of sight, and the blast shapes.
import { RAIL_MAX, RAIL_MIN, TANK_BLOCKS, TANK_MAX, TANK_METAL_WALLS, TANK_MIN, TANK_RAIL_BLOCKS, TANK_RAIL_METAL_WALLS, TANK_RAIL_TURN, TANK_R, TANK_TOTEM_POST, arenaBorder, nearestRail, type TankRect } from '../shared/geometry';
import type { TankState } from '../shared/types';
import { FIRE_HALF, FIRE_LEN, FIRE_STEP } from '../server/TankWars';

export { BOAT_SPEED, BOMB_R, BOMB_RANGE, BOMB_TIME, CANNONS, FIRE_CD, FIRE_HALF, FIRE_LEN, JUNGLE_BLAST, MINE_FUSE, MINE_TRIGGER_R, MUZZLE, PICKUP_R, ROCKET_DMG, ROCKET_SPEED, SHIELD_HOLD, SHOT_R, SWAMP_BLAST, TANK_SPEED, TOTEM_WARN } from '../server/TankWars';
export { TANK_MAX, TANK_MIN, TANK_R };

export interface Body {
  x: number;
  y: number;
  /** rails: the direction it glides in */
  dirX: number;
  dirY: number;
}

export interface Arena {
  rails: boolean;
  maze: boolean;
  /** solid now (blocks and raised metal walls; walls about to switch count as raised) */
  solids: TankRect[];
  speed: number;
}

/** the solids of a snapshot; `maze` and the walls are told by the variant flags */
export function solidsOf(s: TankState, maze: boolean): TankRect[] {
  const out: TankRect[] = maze ? [...(s.rails ? TANK_RAIL_BLOCKS : TANK_BLOCKS)] : [];
  out.push(...arenaBorder(s.size));
  if (s.totem) out.push(TANK_TOTEM_POST);
  if (s.walls) {
    const walls = s.rails ? TANK_RAIL_METAL_WALLS : TANK_METAL_WALLS;
    walls.forEach((w, i) => {
      // about to switch: both groups may block in a moment, keep out of both
      if (s.walls!.raised[i] || s.walls!.warn) out.push(w);
    });
  }
  return out;
}

export function inSolid(x: number, y: number, pad: number, rects: readonly TankRect[]): boolean {
  for (const r of rects) if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
  return false;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** the server's pushOut (TankWars.ts) */
function pushOut(p: { x: number; y: number }, r: number, rect: TankRect): void {
  const nx = clamp(p.x, rect.x, rect.x + rect.w);
  const ny = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - nx;
  const dy = p.y - ny;
  const d = Math.hypot(dx, dy);
  if (d >= r) return;
  if (d > 1e-6) {
    p.x += (dx / d) * (r - d);
    p.y += (dy / d) * (r - d);
    return;
  }
  const l = p.x - rect.x;
  const rt = rect.x + rect.w - p.x;
  const tp = p.y - rect.y;
  const bt = rect.y + rect.h - p.y;
  const m = Math.min(l, rt, tp, bt);
  if (m === l) p.x = rect.x - r;
  else if (m === rt) p.x = rect.x + rect.w + r;
  else if (m === tp) p.y = rect.y - r;
  else p.y = rect.y + rect.h + r;
}

function snapToRail(p: Body): void {
  const dx = Math.abs(p.x - nearestRail(p.x));
  const dy = Math.abs(p.y - nearestRail(p.y));
  if (dx < 0.5 || dy < 0.5) return;
  if (dy <= dx) p.y = nearestRail(p.y);
  else p.x = nearestRail(p.x);
}

/** the server's railDirection (TankWars.ts) */
function railDirection(p: Body, mx: number, my: number): [number, number] {
  snapToRail(p);
  if (Math.hypot(mx, my) <= 0.3) return [0, 0];
  const horiz = Math.abs(mx) >= Math.abs(my);
  if (horiz) {
    if (Math.abs(p.y - nearestRail(p.y)) <= TANK_RAIL_TURN) {
      p.y = nearestRail(p.y);
      p.dirX = Math.sign(mx);
      p.dirY = 0;
    }
  } else if (Math.abs(p.x - nearestRail(p.x)) <= TANK_RAIL_TURN) {
    p.x = nearestRail(p.x);
    p.dirX = 0;
    p.dirY = Math.sign(my);
  }
  return [p.dirX, p.dirY];
}

/** One step of a tank with the stick at (mx, my), as the server moves it. Mutates `b`; returns the facing it drives in (or null). */
export function step(b: Body, mx: number, my: number, dt: number, a: Arena): number | null {
  let vx = 0;
  let vy = 0;
  const len = Math.hypot(mx, my);
  if (a.rails) [vx, vy] = railDirection(b, mx, my);
  else if (len > 0.3) {
    vx = mx / Math.max(1, len);
    vy = my / Math.max(1, len);
  }
  b.x += vx * a.speed * dt;
  b.y += vy * a.speed * dt;
  for (const r of a.solids) pushOut(b, TANK_R, r);
  const lo = a.rails ? RAIL_MIN : TANK_MIN + TANK_R;
  const hi = a.rails ? RAIL_MAX : TANK_MAX - TANK_R;
  b.x = clamp(b.x, lo, hi);
  b.y = clamp(b.y, lo, hi);
  if (a.rails) snapToRail(b);
  return vx !== 0 || vy !== 0 ? Math.atan2(vy, vx) : null;
}

/** nothing solid between the two points (a shot of radius `pad` flies through) */
export function clear(x0: number, y0: number, x1: number, y1: number, solids: readonly TankRect[], pad: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 12);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (inSolid(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, pad, solids)) return false;
  }
  return true;
}

/** how far a shot from (x, y) along (ux, uy) flies before a wall or the field edge, up to `max` */
export function flight(x: number, y: number, ux: number, uy: number, solids: readonly TankRect[], max: number): number {
  for (let d = 0; d < max; d += 12) {
    const px = x + ux * d;
    const py = y + uy * d;
    if (px < TANK_MIN || px > TANK_MAX || py < TANK_MIN || py > TANK_MAX || inSolid(px, py, 6, solids)) return d;
  }
  return max;
}

/** a maze mine's fire: ray lengths up/right/down/left (the server's explodeFire) */
export function fireRays(x: number, y: number, solids: readonly TankRect[]): number[] {
  return [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ].map(([dx, dy]) => {
    let len = 0;
    while (len < FIRE_LEN) {
      const nx = x + dx * (len + FIRE_STEP);
      const ny = y + dy * (len + FIRE_STEP);
      if (nx < TANK_MIN || nx > TANK_MAX || ny < TANK_MIN || ny > TANK_MAX || inSolid(nx, ny, 0, solids)) break;
      len += FIRE_STEP;
    }
    return len;
  });
}

/** is (px, py) inside the fire cross of a mine at (x, y) */
export function inFire(px: number, py: number, x: number, y: number, rays: readonly number[], margin: number): boolean {
  const ox = px - x;
  const oy = py - y;
  if (Math.hypot(ox, oy) <= FIRE_HALF + TANK_R + margin) return true;
  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const [dx, dy] = dirs[i];
    const along = ox * dx + oy * dy;
    const across = Math.abs(ox * dy - oy * dx);
    if (along >= -TANK_R && along <= rays[i] + TANK_R + margin && across <= FIRE_HALF + TANK_R * 0.5 + margin) return true;
  }
  return false;
}
