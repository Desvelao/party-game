// Path distances on the arena: a 10 px grid of where a tank's centre may be (outside the solids, or on the rails
// when rails are on), and a breadth-first distance map from a goal, rebuilt only when the goal or the walls change.
import { RAIL_MAX, RAIL_MIN, TANK_MAX, TANK_MIN, TANK_RAILS, TANK_R, type TankRect } from '../shared/geometry';
import { inSolid } from './physics';

const CELL = 10;
const N = Math.ceil((TANK_MAX - TANK_MIN) / CELL) + 1;
/** free-cell masks by layout (a handful: rails or not, which metal walls are up) */
const MASKS = new Map<string, Uint8Array>();

export class NavGrid {
  private free: Uint8Array = new Uint8Array(N * N);
  private dist = new Int32Array(N * N);
  private queue = new Int32Array(N * N);
  private key = '';
  private goalKey = '';
  private goalAt = -Infinity;
  private gx = 0;
  private gy = 0;

  /** rebuild the free cells when the solids or the mode changed (masks are shared by every bot of the process) */
  setArena(solids: readonly TankRect[], rails: boolean): void {
    const key = `${rails}|${solids.map((r) => `${r.x},${r.y}`).join(';')}`;
    if (key === this.key) return;
    this.key = key;
    this.goalKey = '';
    const cached = MASKS.get(key);
    if (cached) {
      this.free = cached;
      return;
    }
    this.free = new Uint8Array(N * N);
    if (MASKS.size > 16) MASKS.clear();
    MASKS.set(key, this.free);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = TANK_MIN + i * CELL;
        const y = TANK_MIN + j * CELL;
        let ok: boolean;
        if (rails) {
          const onRail = TANK_RAILS.some((r) => Math.abs(x - r) < CELL / 2 || Math.abs(y - r) < CELL / 2);
          ok = onRail && x >= RAIL_MIN - CELL / 2 && x <= RAIL_MAX + CELL / 2 && y >= RAIL_MIN - CELL / 2 && y <= RAIL_MAX + CELL / 2 && !inSolid(x, y, TANK_R - 4, solids);
        } else ok = x >= TANK_MIN + TANK_R && x <= TANK_MAX - TANK_R && y >= TANK_MIN + TANK_R && y <= TANK_MAX - TANK_R && !inSolid(x, y, TANK_R - 2, solids);
        this.free[j * N + i] = ok ? 1 : 0;
      }
    }
  }

  private cellOf(x: number, y: number): number {
    const i = Math.max(0, Math.min(N - 1, Math.round((x - TANK_MIN) / CELL)));
    const j = Math.max(0, Math.min(N - 1, Math.round((y - TANK_MIN) / CELL)));
    return j * N + i;
  }

  /** the free cell nearest to (x, y) (a goal inside a wall moves out of it) */
  private nearestFree(x: number, y: number): number {
    const c = this.cellOf(x, y);
    if (this.free[c]) return c;
    let best = -1;
    let bestD = Infinity;
    const ci = c % N;
    const cj = (c - ci) / N;
    for (let r = 1; r < 30 && best < 0; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= N || j >= N || !this.free[j * N + i]) continue;
          const d = (i - ci) ** 2 + (j - cj) ** 2;
          if (d < bestD) {
            bestD = d;
            best = j * N + i;
          }
        }
      }
    }
    return best < 0 ? c : best;
  }

  /** set the goal (the distance map is rebuilt only when its cell changes) */
  setGoal(x: number, y: number, nowMs = 0): void {
    // a goal that moves (a rival) is followed in 30 px steps, at most every 250 ms
    if (this.goalKey && nowMs - this.goalAt < 250 && Math.hypot(x - this.gx, y - this.gy) < 30) return;
    this.goalAt = nowMs;
    this.gx = x;
    this.gy = y;
    const g = this.nearestFree(x, y);
    const key = `${g}`;
    if (key === this.goalKey) return;
    this.goalKey = key;
    this.dist.fill(-1);
    let head = 0;
    let tail = 0;
    this.dist[g] = 0;
    this.queue[tail++] = g;
    while (head < tail) {
      const c = this.queue[head++];
      const i = c % N;
      const j = (c - i) / N;
      const d = this.dist[c] + 1;
      if (i > 0 && this.free[c - 1] && this.dist[c - 1] < 0) (this.dist[c - 1] = d), (this.queue[tail++] = c - 1);
      if (i < N - 1 && this.free[c + 1] && this.dist[c + 1] < 0) (this.dist[c + 1] = d), (this.queue[tail++] = c + 1);
      if (j > 0 && this.free[c - N] && this.dist[c - N] < 0) (this.dist[c - N] = d), (this.queue[tail++] = c - N);
      if (j < N - 1 && this.free[c + N] && this.dist[c + N] < 0) (this.dist[c + N] = d), (this.queue[tail++] = c + N);
    }
  }

  /** path distance (px) from (x, y) to the goal; unreachable = a large number */
  distance(x: number, y: number): number {
    const d = this.dist[this.nearestFree(x, y)];
    return d < 0 ? 5000 : d * CELL;
  }
}
