// The Tank Wars policy. A tank faces the way it drives, so moving and aiming are one choice. Each decision simulates
// the stick directions (16 when driving freely, the 4 axes on rails) for 0.6 s with the server's movement rules and
// scores them: shots that would hit (from their facing and cannon type), mines about to blow (radius, or the fire
// cross of the maze), bombs landing, the totem falling, plus the path distance to where it wants to be (a fruit when
// hurt, an item, a mine pick-up, or a firing spot near the rival it works on). Then it checks the aiming direction:
// a rival in line of sight (on rails: on the same rail line), with lead, no teammate in the way; if steering that way
// costs little more than the best move, it drives that way and holds the cannon. Items and mines are used on top.
import { circleBar } from '../../../../core/shared/kit/collision';
import { jitter } from '../../../../core/shared/kit/humanize';
import { RAIL_MAX, RAIL_MIN, TANK_CENTRE, TANK_TOTEM_HALF, TANK_TOTEM_LEN, nearestRail } from '../../shared/geometry';
import { NavGrid } from '../nav';
import { BOMB_R, BOMB_RANGE, BOMB_TIME, CANNONS, JUNGLE_BLAST, MINE_TRIGGER_R, ROCKET_SPEED, SHOT_R, SWAMP_BLAST, TANK_R, TOTEM_WARN, clear, inFire, step, type Body } from '../physics';
import type { WTank, World } from '../world';
import { idle, type Decision, type Policy } from './types';

const DT = 0.12;
const STEPS = 5;
const FREE: [number, number][] = [];
for (let i = 0; i < 16; i++) FREE.push([Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);
FREE.push([0, 0]);
const RAIL: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0, 0],
];
/** a shot this far from the tank centre hits */
const HIT = TANK_R + SHOT_R;

export class TacticianPolicy implements Policy {
  private nav = new NavGrid();
  private body: Body = { x: 0, y: 0, dirX: 0, dirY: 0 };
  private px = new Float64Array(STEPS + 1);
  private py = new Float64Array(STEPS + 1);
  private aimErr = 0;
  private aimErrUntil = 0;
  private mineAt = -Infinity;

  constructor(private readonly P: Record<string, number>, private readonly rng: () => number) {}

  prepare(w: World): void {
    this.nav.setArena(w.arena.solids, w.arena.rails);
  }

  decide(w: World, nowMs: number): Decision {
    const me = w.me;
    if (!me) return idle();
    const P = this.P;
    const A = w.arena;
    if (nowMs >= this.aimErrUntil) {
      this.aimErr = jitter(this.rng) * P.aimNoise;
      this.aimErrUntil = nowMs + 400;
    }
    const target = this.pickTarget(w, me);
    const goal = this.pickGoal(w, me, target);
    this.nav.setArena(A.solids, A.rails);
    this.nav.setGoal(goal.x, goal.y, nowMs);

    const cands = A.rails ? RAIL : FREE;
    let best = 0;
    let bestCost = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const c = this.cost(w, me, cands[i][0], cands[i][1]);
      if (c < bestCost) {
        bestCost = c;
        best = i;
      }
    }
    const d = idle(goal.kind);
    d.goal = { x: Math.round(goal.x), y: Math.round(goal.y) };
    d.target = target?.id ?? null;
    d.mx = cands[best][0];
    d.my = cands[best][1];
    d.cost = bestCost;

    // aim: drive at the rival (with lead) if it costs little more than the best move
    if (target && !me.up) {
      const aim = this.aimAt(w, me, target);
      if (aim) {
        // aiming is a short detour (it is decided again 30 times a second): the way to the goal counts after `aimStep` steps
        const c = this.cost(w, me, aim[0], aim[1], Math.round(this.P.aimStep));
        if (c <= bestCost + 0.6 * P.aggression + 0.05) {
          d.mx = aim[0];
          d.my = aim[1];
          d.cost = c;
          d.fire = true;
          d.mode = 'attack';
          if (me.item === 'missile' && P.items > 0) d.item = true;
        }
      }
    }
    // the cannon also fires when the move we chose happens to point at a rival
    if (!d.fire && (d.mx || d.my) && P.fireDiscipline < 1) d.fire = this.pointsAtRival(w, me, Math.atan2(d.my, d.mx), 0.25 * (1 - P.fireDiscipline));
    if (me.item === 'bomb' && P.items > 0) d.item = this.bombHits(w, me, d);
    if (me.mines > 0 && P.mines > 0 && nowMs - this.mineAt > 2500) d.mine = this.mineWorth(w, me, d);
    if (d.mine) this.mineAt = nowMs;
    d.info.cost = +d.cost.toFixed(2);
    return d;
  }

  /** the rival to work on: the closest by path, weaker ones a bit closer */
  private pickTarget(w: World, me: WTank): WTank | null {
    let best: WTank | null = null;
    let bs = Infinity;
    for (const r of w.rivals) {
      const s = Math.hypot(r.x - me.x, r.y - me.y) + r.hp * 2;
      if (s < bs) {
        bs = s;
        best = r;
      }
    }
    return best;
  }

  private pickGoal(w: World, me: WTank, target: WTank | null): { x: number; y: number; kind: string } {
    const P = this.P;
    const maxHp = w.state.maxHp;
    let bestPick: { x: number; y: number; kind: string } | null = null;
    let bd = Infinity;
    for (const k of w.pickups) {
      if (k.land > 0.3) continue;
      const d = Math.hypot(k.x - me.x, k.y - me.y);
      let worth = 0;
      if (k.k === 'fruit' && me.hp <= maxHp * 0.6) worth = 600 * P.items;
      else if ((k.k === 'bomb' || k.k === 'missile') && !me.item) worth = 380 * P.items;
      else if (k.k === 'mine' && me.mines < 3) worth = 250 * P.items * P.mines;
      if (worth > d && d < bd) {
        bd = d;
        bestPick = { x: k.x, y: k.y, kind: 'pickup' };
      }
    }
    if (bestPick) return bestPick;
    if (!target) return { x: TANK_CENTRE, y: TANK_CENTRE, kind: 'move' };
    if (w.arena.rails) return this.railSpot(w, me, target);
    // a firing spot: back along the line to us, at a distance that shrinks with aggression
    const dist = Math.hypot(me.x - target.x, me.y - target.y) || 1;
    const stand = 340 - 120 * P.aggression;
    const gx = target.x + ((me.x - target.x) / dist) * stand;
    const gy = target.y + ((me.y - target.y) / dist) * stand;
    if (w.arena.maze && !clear(gx, gy, target.x, target.y, w.arena.solids, SHOT_R)) return { x: target.x, y: target.y, kind: 'move' };
    return { x: gx, y: gy, kind: 'move' };
  }

  /** on rails: a spot on the rival's rail line, in sight of it and some way off (it can only be shot along that line) */
  private railSpot(w: World, me: WTank, t: WTank): { x: number; y: number; kind: string } {
    const stand = 300 - 100 * this.P.aggression;
    let best: { x: number; y: number; kind: string } | null = null;
    let bd = Infinity;
    const onH = Math.abs(t.y - nearestRail(t.y)) < 1;
    const onV = Math.abs(t.x - nearestRail(t.x)) < 1;
    for (const d of [stand, stand * 0.7, stand * 1.4]) {
      const spots: [number, number][] = [];
      if (onH) spots.push([t.x - d, t.y], [t.x + d, t.y]);
      if (onV) spots.push([t.x, t.y - d], [t.x, t.y + d]);
      for (const [x, y] of spots) {
        if (x < RAIL_MIN || x > RAIL_MAX || y < RAIL_MIN || y > RAIL_MAX || !clear(x, y, t.x, t.y, w.arena.solids, SHOT_R)) continue;
        const dist = Math.hypot(x - me.x, y - me.y);
        if (dist < bd) {
          bd = dist;
          best = { x, y, kind: 'move' };
        }
      }
      if (best) break;
    }
    return best ?? { x: t.x, y: t.y, kind: 'move' };
  }

  /** the stick that faces the rival with lead, when it is in sight; null otherwise */
  private aimAt(w: World, me: WTank, t: WTank): [number, number] | null {
    const P = this.P;
    const A = w.arena;
    if (A.rails) {
      // on rails it can only face along the rail it is on: the rival must be on the same line
      if (Math.abs(t.y - me.y) < 14 && clear(me.x, me.y, t.x, me.y, A.solids, SHOT_R) && !this.allyBetween(w, me, t)) return [Math.sign(t.x - me.x) || 1, 0];
      if (Math.abs(t.x - me.x) < 14 && clear(me.x, me.y, me.x, t.y, A.solids, SHOT_R) && !this.allyBetween(w, me, t)) return [0, Math.sign(t.y - me.y) || 1];
      return null;
    }
    const speed = me.item === 'missile' ? ROCKET_SPEED : CANNONS[me.cannon]?.speed ?? 520;
    // intercept: |T + V t - M| = speed t
    const rx = t.x - me.x;
    const ry = t.y - me.y;
    const vx = t.vx * P.lead;
    const vy = t.vy * P.lead;
    const a = vx * vx + vy * vy - speed * speed;
    const b = 2 * (rx * vx + ry * vy);
    const c = rx * rx + ry * ry;
    let tt = Math.sqrt(c) / speed;
    const disc = b * b - 4 * a * c;
    if (Math.abs(a) > 1e-6 && disc >= 0) {
      const t1 = (-b - Math.sqrt(disc)) / (2 * a);
      const t2 = (-b + Math.sqrt(disc)) / (2 * a);
      tt = Math.min(...[t1, t2].filter((x) => x > 0), tt);
    }
    if (tt > 1.6) return null;
    const ax = rx + vx * tt;
    const ay = ry + vy * tt;
    if (!clear(me.x, me.y, me.x + ax, me.y + ay, A.solids, SHOT_R) || this.allyBetween(w, me, { x: me.x + ax, y: me.y + ay })) return null;
    const ang = Math.atan2(ay, ax) + this.aimErr;
    return [Math.cos(ang), Math.sin(ang)];
  }

  private allyBetween(w: World, me: WTank, t: { x: number; y: number }): boolean {
    const dx = t.x - me.x;
    const dy = t.y - me.y;
    const L = Math.hypot(dx, dy) || 1;
    for (const a of w.allies) {
      const along = ((a.x - me.x) * dx + (a.y - me.y) * dy) / L;
      if (along <= 0 || along >= L) continue;
      if (Math.abs((a.x - me.x) * dy - (a.y - me.y) * dx) / L < TANK_R + 8) return true;
    }
    return false;
  }

  private pointsAtRival(w: World, me: WTank, ang: number, tol: number): boolean {
    for (const r of w.rivals) {
      const a = Math.atan2(r.y - me.y, r.x - me.x);
      let e = Math.abs(a - ang) % (Math.PI * 2);
      if (e > Math.PI) e = Math.PI * 2 - e;
      if (e < tol && Math.hypot(r.x - me.x, r.y - me.y) < 650 && clear(me.x, me.y, r.x, r.y, w.arena.solids, SHOT_R) && !this.allyBetween(w, me, r)) return true;
    }
    return false;
  }

  /** a lobbed bomb lands BOMB_RANGE ahead (along the way we drive this tick) in BOMB_TIME s: on a rival? */
  private bombHits(w: World, me: WTank, d: Decision): boolean {
    const ang = d.mx || d.my ? Math.atan2(d.my, d.mx) : me.f;
    const lx = me.x + Math.cos(ang) * BOMB_RANGE;
    const ly = me.y + Math.sin(ang) * BOMB_RANGE;
    if (Math.hypot(lx - me.x, ly - me.y) < BOMB_R + TANK_R) return false;
    for (const r of w.rivals) if (Math.hypot(r.x + r.vx * BOMB_TIME - lx, r.y + r.vy * BOMB_TIME - ly) < BOMB_R * 0.7) return true;
    return false;
  }

  /** drop a mine when a rival is close behind (we drive away from it) */
  private mineWorth(w: World, me: WTank, d: Decision): boolean {
    if (!d.mx && !d.my) return false;
    for (const r of w.rivals) {
      const dx = me.x - r.x;
      const dy = me.y - r.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 220 || dist < 1) continue;
      if ((dx * d.mx + dy * d.my) / dist > 0.5 && this.rng() < this.P.mines) return true;
    }
    return false;
  }

  /** how bad steering (cx, cy) for STEPS * DT is: hazards met on the way and the path left to the goal */
  private cost(w: World, me: WTank, cx: number, cy: number, goalStep = STEPS): number {
    const P = this.P;
    const b = this.body;
    b.x = me.x;
    b.y = me.y;
    b.dirX = w.glide[0];
    b.dirY = w.glide[1];
    this.px[0] = b.x;
    this.py[0] = b.y;
    for (let k = 1; k <= STEPS; k++) {
      step(b, cx, cy, DT, w.arena);
      this.px[k] = b.x;
      this.py[k] = b.y;
    }
    let cost = 0;
    // shots: closest approach between our path and each shot's, step by step
    if (P.dodge > 0) {
      for (const s of w.shots) {
        for (let k = 1; k <= STEPS; k++) {
          const t0 = (k - 1) * DT;
          const t1 = k * DT;
          if (t0 > s.tMax) break;
          const ax = this.px[k - 1] - (s.x + s.vx * t0);
          const ay = this.py[k - 1] - (s.y + s.vy * t0);
          const bx = this.px[k] - (s.x + s.vx * Math.min(t1, s.tMax));
          const by = this.py[k] - (s.y + s.vy * Math.min(t1, s.tMax));
          if (segDist(ax, ay, bx, by) < HIT + 4) {
            cost += (s.dmg / 10) * P.dodge;
            break;
          }
        }
      }
    }
    if (P.hazards > 0) {
      const H = P.hazards;
      for (const m of w.mines) {
        for (let k = 0; k <= STEPS; k++) {
          const x = this.px[k];
          const y = this.py[k];
          if (m.contact) {
            if (Math.hypot(x - m.x, y - m.y) < MINE_TRIGGER_R + TANK_R * 0.5 + 8) {
              cost += 4.5 * H;
              break;
            }
            continue;
          }
          const inside = m.rays ? inFire(x, y, m.x, m.y, m.rays, 8) : Math.hypot(x - m.x, y - m.y) <= (w.swamp ? SWAMP_BLAST : JUNGLE_BLAST) + TANK_R * 0.5 + 8;
          if (!inside) continue;
          // blowing up while we are there, or soon (so it walks out of a mine's reach in time)
          const t = k * DT;
          cost += (Math.abs(m.t - t) < 0.2 ? 4.5 : m.t < 1.5 ? 0.6 : 0.1) * H;
          break;
        }
      }
      for (const bo of w.bombs) {
        const k = Math.min(STEPS, Math.max(0, Math.round(bo.t / DT)));
        if (Math.hypot(this.px[k] - bo.x, this.py[k] - bo.y) < BOMB_R + TANK_R * 0.5 + 10) cost += 4 * H;
      }
      const tot = w.totem;
      if (tot && tot.warn > 0) {
        const k = Math.min(STEPS, Math.round((tot.warn * TOTEM_WARN) / DT));
        if (circleBar(this.px[k], this.py[k], TANK_R + 10, TANK_CENTRE, TANK_CENTRE, tot.a, TANK_TOTEM_LEN, TANK_TOTEM_HALF).hit) cost += 5 * H;
      }
    }
    // seconds of driving left to the goal
    cost += this.nav.distance(this.px[goalStep], this.py[goalStep]) / w.arena.speed;
    return cost;
  }
}

/** distance from the origin to the segment a-b */
function segDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}
