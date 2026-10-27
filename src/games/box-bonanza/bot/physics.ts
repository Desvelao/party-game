// What the bot knows of Box Bonanza: the server's own constants (imported, so the two cannot drift), the player's
// grip-based movement, how a sliding crate slows, and the floor holes.
import { CRATE_ARENA } from '../shared/geometry';
import { CARRY_SLOW, CRATE_FRICTION, CRATE_R, GRID, PLAYER_R, SPEED, TILE } from '../server/BoxBonanza';

export { BOOTS_SPEED, CRATE_FRICTION, CRATE_R, DAMAGE, FLY_MIN, GRIP, GRIP_ICE, HOLD_DIST, KICK_SPEED, MISSILE_SPEED, ORB_SPEED, PENGUIN_R, PENGUIN_SPIN, PLAYER_R, RING_RANGE, SPEED, THROW_SPEED, Z_SPEED } from '../server/BoxBonanza';

export const X0 = CRATE_ARENA.x;
export const Y0 = CRATE_ARENA.y;
export const X1 = CRATE_ARENA.x + CRATE_ARENA.size;
export const Y1 = CRATE_ARENA.y + CRATE_ARENA.size;
export const CX = (X0 + X1) / 2;
export const CY = (Y0 + Y1) / 2;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Move {
  top: number;
  grip: number;
}

export function moveOf(boots: number, slow: number, holding: boolean, grip: number, bootsK: number, zK: number): Move {
  let top = SPEED;
  if (boots > 0) top *= bootsK;
  if (slow > 0) top *= zK;
  if (holding) top *= CARRY_SLOW;
  return { top, grip };
}

/** One step of a player steering (mx, my) as the server moves it, against the walls and the resting crates. Mutates `b`. */
export function step(b: Body, mx: number, my: number, dt: number, m: Move, solids: readonly { x: number; y: number }[]): void {
  const k = Math.min(1, m.grip * dt);
  b.vx += (mx * m.top - b.vx) * k;
  b.vy += (my * m.top - b.vy) * k;
  b.x = Math.max(X0 + PLAYER_R, Math.min(X1 - PLAYER_R, b.x + b.vx * dt));
  b.y = Math.max(Y0 + PLAYER_R, Math.min(Y1 - PLAYER_R, b.y + b.vy * dt));
  const min = PLAYER_R + CRATE_R;
  for (const c of solids) {
    const dx = b.x - c.x;
    const dy = b.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1;
    b.x = c.x + (dx / d) * min;
    b.y = c.y + (dy / d) * min;
  }
}

/** where a sliding crate is after t s (friction only; walls left out) */
export function slide(x: number, y: number, vx: number, vy: number, t: number): { x: number; y: number; speed: number } {
  const e = Math.exp(-CRATE_FRICTION * t);
  const k = (1 - e) / CRATE_FRICTION;
  return { x: x + vx * k, y: y + vy * k, speed: Math.hypot(vx, vy) * e };
}

/** is (x, y) over a hole (Space Bonanza) */
export function holeAt(holes: readonly number[], tiles: number, x: number, y: number): boolean {
  if (!tiles) return false;
  const c = Math.floor((x - X0) / TILE);
  const r = Math.floor((y - Y0) / TILE);
  if (c < 0 || r < 0 || c >= GRID || r >= GRID) return false;
  return holes[r * GRID + c] === 1;
}
