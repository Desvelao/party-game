// The Box Bonanza policy. Each decision simulates 16 stick directions (and letting go) for half a second with the
// server's grip-based movement and scores them: flying crates it did not send (they hurt by kind), lit TNT about to
// blow (sliding, or carried by someone), nitro (touching it blows it up), enemy shots, the penguin, holes in the
// floor, bad power-ups, a rival carrying the weight; minus the good pick-ups it reaches; plus the distance to where
// it wants to be (a crate to pick up, a heal, a ? crate, the rival it works on, or a rival to pass the weight to).
// On top: pick up when the server says a crate is in reach, throw (with lead) when a rival is in range, kick a rival in
// reach or a crate towards one, fire a weapon when it will hit.
import { jitter } from '../../../../core/shared/kit/humanize';
import { CRATE_DEFAULTS } from '../../server/config';
import { BOOTS_SPEED, CRATE_FRICTION, CRATE_R, CX, CY, DAMAGE, FLY_MIN, GRIP, GRIP_ICE, MISSILE_SPEED, PENGUIN_R, PENGUIN_SPIN, PLAYER_R, RING_RANGE, THROW_SPEED, X0, X1, Y0, Y1, Z_SPEED, holeAt, moveOf, slide, step, type Body, type Move } from '../physics';
import type { Rules, VariantAdapter } from '../variants';
import type { WCrate, WPlayer, World } from '../world';
import { idle, type Decision, type Policy } from './types';

const DT = 0.1;
const STEPS = 5;
const CANDS: [number, number][] = [];
for (let i = 0; i < 16; i++) CANDS.push([Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);
CANDS.push([0, 0]);
/** farthest a thrown crate still hurts: it stops being dangerous below FLY_MIN */
const THROW_REACH = ((THROW_SPEED - FLY_MIN) / CRATE_FRICTION) * 0.9;
const KICK_RANGE = CRATE_DEFAULTS.kickRange;

export class BrawlerPolicy implements Policy {
  private body: Body = { x: 0, y: 0, vx: 0, vy: 0 };
  private aimErr = 0;
  private aimErrUntil = 0;

  constructor(private readonly P: Record<string, number>, private readonly rng: () => number, private adapter: VariantAdapter) {}

  setAdapter(a: VariantAdapter): void {
    this.adapter = a;
  }

  decide(w: World, nowMs: number): Decision {
    const me = w.me;
    if (!me) return idle();
    const P = this.P;
    const R = this.adapter.rules;
    if (nowMs >= this.aimErrUntil) {
      this.aimErr = jitter(this.rng) * P.aimNoise;
      this.aimErrUntil = nowMs + 500;
    }
    const move = moveOf(me.boots, me.slow, !!me.hold, R.slippery ? GRIP_ICE : GRIP, BOOTS_SPEED, Z_SPEED);
    const target = this.pickTarget(w, me);
    const goal = this.pickGoal(w, me, target, R);
    const solids = w.crates.filter((c) => !c.moving && c.k !== 'nitro' && Math.hypot(c.x - me.x, c.y - me.y) < 220 && (goal.crate === undefined || c.id !== goal.crate));
    let best = CANDS.length - 1;
    let bestCost = Infinity;
    for (let i = 0; i < CANDS.length; i++) {
      const c = this.cost(w, me, R, CANDS[i][0], CANDS[i][1], move, solids, goal);
      if (c < bestCost) {
        bestCost = c;
        best = i;
      }
    }
    const d = idle(goal.kind);
    d.mx = CANDS[best][0];
    d.my = CANDS[best][1];
    d.cost = bestCost;
    d.target = target?.id ?? null;
    d.goal = { x: Math.round(goal.x), y: Math.round(goal.y) };
    this.actions(w, me, target, d);
    d.info.cost = +bestCost.toFixed(2);
    return d;
  }

  private pickTarget(w: World, me: WPlayer): WPlayer | null {
    let best: WPlayer | null = null;
    let bs = Infinity;
    for (const r of w.rivals) {
      const s = Math.hypot(r.x - me.x, r.y - me.y) + r.hp * 25;
      if (s < bs) {
        bs = s;
        best = r;
      }
    }
    return best;
  }

  private pickGoal(w: World, me: WPlayer, target: WPlayer | null, R: Rules): { x: number; y: number; kind: string; crate?: number } {
    const P = this.P;
    const dist = (x: number, y: number) => Math.hypot(x - me.x, y - me.y);
    // carrying the weight: hand it on by touching someone
    if (me.weight > 0 && target) return { x: target.x, y: target.y, kind: 'pass-weight' };
    // a heal, a ? crate or a good power-up close enough to be worth the walk
    let pick: { x: number; y: number; kind: string } | null = null;
    let pickScore = 0;
    for (const it of w.state.pickups) {
      let worth = 0;
      if (it.k === 'berry' && me.hp <= w.state.maxHp - 2) worth = (me.hp <= w.state.maxHp / 2 ? 500 : 250) * P.items;
      else if (it.k === 'qbox' && !me.charges) worth = 350 * P.items * P.weapons;
      else if (it.k === 'mask' && me.mask <= 0) worth = 300 * P.items;
      else if (it.k === 'boots' && me.boots <= 0) worth = 180 * P.items;
      if (!worth || (R.floorHoles && holeAt(w.state.holes, w.state.tiles, it.x, it.y))) continue;
      const s = worth - dist(it.x, it.y);
      if (s > pickScore) {
        pickScore = s;
        pick = { x: it.x, y: it.y, kind: 'pickup' };
      }
    }
    if (pick) return pick;
    if (!me.hold && !(me.weapon && me.charges)) {
      // a crate to pick up: near us and, better, near the rival
      let best: WCrate | null = null;
      let bs = Infinity;
      for (const c of w.crates) {
        if (c.moving || c.k === 'nitro' || (c.fuse >= 0 && c.fuse < 1.5)) continue;
        const s = dist(c.x, c.y) + (target ? Math.hypot(c.x - target.x, c.y - target.y) * 0.3 : 0);
        if (s < bs) {
          bs = s;
          best = c;
        }
      }
      if (best) return { x: best.x, y: best.y, kind: 'crate', crate: best.id };
    }
    if (!target) return { x: CX, y: CY, kind: 'idle' };
    // with a crate or a weapon: get in range (closer the more aggressive)
    // a TNT blows up on the rival it hits: throw it from outside its blast (and the holes it leaves)
    const tntStand = w.state.blastRadius + PLAYER_R + 90;
    const stand = me.hold === 'tnt' ? tntStand : me.hold ? 300 - 120 * P.aggression : me.weapon === 'ring' ? RING_RANGE * 0.6 : 220;
    const dd = dist(target.x, target.y) || 1;
    return { x: target.x + ((me.x - target.x) / dd) * stand, y: target.y + ((me.y - target.y) / dd) * stand, kind: 'attack' };
  }

  private cost(w: World, me: WPlayer, R: Rules, cx: number, cy: number, m: Move, solids: readonly WCrate[], goal: { x: number; y: number }): number {
    const P = this.P;
    const s = w.state;
    const b = this.body;
    b.x = me.x;
    b.y = me.y;
    b.vx = me.vx;
    b.vy = me.vy;
    let cost = 0;
    const got = new Set<number>();
    for (let k = 1; k <= STEPS; k++) {
      step(b, cx, cy, DT, m, solids);
      const t = k * DT;
      if (R.floorHoles) {
        if (holeAt(s.holes, s.tiles, b.x, b.y)) cost += 50;
        // a kick or a blast throws you a long way: keep off the edge of a hole too
        else if (P.dodge > 0 && holeNear(s.holes, s.tiles, b.x, b.y, 40)) cost += 1.5 * P.dodge;
      }
      if (P.dodge > 0) {
        for (const c of w.crates) {
          if (c.mine) continue;
          if (c.k === 'nitro' && !c.moving) {
            if (Math.hypot(c.x - b.x, c.y - b.y) < PLAYER_R + CRATE_R + 6) cost += 6;
            continue;
          }
          const p = c.moving ? slide(c.x, c.y, c.vx, c.vy, t) : { x: c.x, y: c.y, speed: 0 };
          if (c.moving && p.speed > FLY_MIN && Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_R + CRATE_R + 6) cost += DAMAGE[c.k] * 0.8 * P.dodge;
          if (c.fuse >= 0 && Math.hypot(p.x - b.x, p.y - b.y) < s.blastRadius + PLAYER_R + 10) cost += (c.fuse - t < 0.3 ? 4 : c.fuse < 1.5 ? 0.5 : 0.1) * P.dodge;
        }
        for (const h of w.heldTnt) if (Math.hypot(h.x - b.x, h.y - b.y) < s.blastRadius + PLAYER_R + 10) cost += (h.fuse - t < 0.4 ? 3 : 0.3) * P.dodge;
        for (const q of w.shots) if (Math.hypot(q.x + q.vx * t - b.x, q.y + q.vy * t - b.y) < PLAYER_R + 14) cost += 2 * P.dodge;
        if (w.penguin) {
          const a = w.penguin.a + PENGUIN_SPIN * t;
          if (Math.hypot(CX + Math.cos(a) * w.penguin.r - b.x, CY + Math.sin(a) * w.penguin.r - b.y) < PENGUIN_R + PLAYER_R + 12) cost += 3 * P.dodge;
        } else if (R.penguin && Math.hypot(b.x - CX, b.y - CY) < PENGUIN_R + PLAYER_R + 8) cost += 0.5;
        for (const r of w.rivals) if (r.weight > 0 && me.weight <= 0 && Math.hypot(r.x - b.x, r.y - b.y) < PLAYER_R * 2 + 8) cost += 4;
      }
      for (const it of s.pickups) {
        if (got.has(it.id) || Math.hypot(it.x - b.x, it.y - b.y) > PLAYER_R + 20) continue;
        got.add(it.id);
        if (it.k === 'z' || (it.k === 'weight' && me.weight <= 0)) cost += 3 * P.items;
        else if (it.k === 'berry' && me.hp < s.maxHp) cost -= 1.5 * P.items;
        else if ((it.k === 'mask' && me.mask <= 0) || (it.k === 'qbox' && !me.charges)) cost -= 1.5 * P.items;
      }
    }
    return cost + Math.hypot(b.x - goal.x, b.y - goal.y) / m.top;
  }

  /** the press of the turn: weapon, throw, pick up, kick */
  private actions(w: World, me: WPlayer, target: WPlayer | null, d: Decision): void {
    const P = this.P;
    const near = (q: { x: number; y: number }) => Math.hypot(q.x - me.x, q.y - me.y);
    if (me.weapon && me.charges > 0) {
      // a1 fires the weapon before it throws or picks up anything, so nothing else is tried while armed
      if (target) {
        const dist = near(target);
        const fire = me.weapon === 'ring' ? dist < RING_RANGE - 10 : me.weapon === 'missile' ? dist < MISSILE_SPEED * 0.6 : dist < 650;
        if (fire && this.rng() < 0.3 + 0.7 * P.weapons) {
          d.act = true;
          d.aim = Math.atan2(target.y - me.y, target.x - me.x);
          d.mode = 'weapon';
        }
      }
    } else if (me.hold) {
      // a lit TNT in hand: throw it before it goes off, at a rival if there is one, away from us anyway
      const urgent = me.hold === 'tnt' && me.holdFuse >= 0 && me.holdFuse < 0.9;
      const aim = target ? this.throwAim(w, me, target) : null;
      if (aim !== null || urgent) {
        d.act = true;
        // an urgent throw with nobody to aim at safely: as far from everyone as it can (towards the open floor)
        d.aim = aim ?? this.awayAim(w, me);
        d.mode = 'throw';
      }
    } else if (me.target >= 0) {
      const c = w.crates.find((x) => x.id === me.target);
      if (c && !(c.fuse >= 0 && c.fuse < 1.2)) {
        d.act = true;
        d.mode = 'pickup';
      }
    }
    if (P.kick > 0 && this.rng() < 0.2 + 0.8 * P.kick) {
      const inReach = (q: { x: number; y: number }) => near(q) < KICK_RANGE - 6;
      if (!w.allies.some(inReach)) {
        if (w.rivals.some(inReach)) {
          d.kick = true;
          d.mode = 'kick';
        } else if (target && !me.hold) {
          // a resting crate beside us flies straight away from us: kick it when the rival is behind it
          for (const c of w.crates) {
            if (c.moving || c.k === 'nitro' || near(c) > KICK_RANGE + CRATE_R - 6) continue;
            const ca = Math.atan2(c.y - me.y, c.x - me.x);
            const ta = Math.atan2(target.y - me.y, target.x - me.x);
            const off = Math.abs(Math.atan2(Math.sin(ca - ta), Math.cos(ca - ta)));
            if (off < 0.3 && near(target) < THROW_REACH * 0.8) {
              d.kick = true;
              d.mode = 'kick-crate';
              break;
            }
          }
        }
      }
    }
  }

  /** the direction with the most room and nobody near (for a TNT that must go now) */
  private awayAim(w: World, me: WPlayer): number {
    let best = Math.atan2(CY - me.y, CX - me.x);
    let bs = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lx = me.x + Math.cos(a) * 250;
      const ly = me.y + Math.sin(a) * 250;
      if (lx < X0 || lx > X1 || ly < Y0 || ly > Y1) continue;
      let s = 0;
      for (const q of [...w.rivals, ...w.allies]) s += Math.min(300, Math.hypot(q.x - lx, q.y - ly));
      if (s > bs) {
        bs = s;
        best = a;
      }
    }
    return best;
  }

  /** the facing that throws the held crate into the rival (with lead), or null when it would miss or fall short */
  private throwAim(w: World, me: WPlayer, t: WPlayer): number | null {
    const P = this.P;
    const dist = Math.hypot(t.x - me.x, t.y - me.y);
    if (dist > THROW_REACH) return null;
    // never a TNT into a rival standing inside its blast around us
    if (me.hold === 'tnt' && dist < w.state.blastRadius + PLAYER_R * 2 + 20) return null;
    // time for the crate to cover the distance: d = v0 (1 - e^-kt) / k
    const f = 1 - (CRATE_FRICTION * dist) / THROW_SPEED;
    const tt = f > 0 ? -Math.log(f) / CRATE_FRICTION : 1;
    const ax = t.x + t.vx * tt * P.lead - me.x;
    const ay = t.y + t.vy * tt * P.lead - me.y;
    for (const a of w.allies) {
      const along = ((a.x - me.x) * ax + (a.y - me.y) * ay) / (Math.hypot(ax, ay) || 1);
      if (along > 0 && along < Math.hypot(ax, ay) && Math.abs((a.x - me.x) * ay - (a.y - me.y) * ax) / (Math.hypot(ax, ay) || 1) < PLAYER_R + CRATE_R) return null;
    }
    return Math.atan2(ay, ax) + this.aimErr;
  }
}

function holeNear(holes: readonly number[], tiles: number, x: number, y: number, r: number): boolean {
  return holeAt(holes, tiles, x + r, y) || holeAt(holes, tiles, x - r, y) || holeAt(holes, tiles, x, y + r) || holeAt(holes, tiles, x, y - r);
}
