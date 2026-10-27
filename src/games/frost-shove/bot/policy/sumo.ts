// The Frost Shove policy. Each decision simulates a handful of stick directions for `lookahead` seconds (the bear's own
// physics, rivals coasting) and scores where each one leads: ice left under the bear, being in a rival's dash reach
// with the edge behind, the variant's hazards (bolt bands, bombs), boxes, and getting behind the rival it works on
// (between the rival and the centre, so a push sends it out), or waiting where a rival in the water climbs back. Separately it decides whether to dash: into a rival
// whose back is to the edge, or, to save itself, towards the centre when it is sliding off.
import { clamp } from '../../../../core/shared/kit/util';
import { jitter } from '../../../../core/shared/kit/humanize';
import { ITEM_R } from '../../server/FrostShove';
import { polarEdge } from '../../shared/geometry';
import { BOLT_HALF, BOLT_ON, BOMB_BLAST, C, DASH_COST, DASH_REACH, KNOCK, boltSide, coast, margin, rayToEdge, step, wallUp, type Body } from '../physics';
import type { WBear, World } from '../world';
import { idle, type Decision, type Policy } from './types';

const DT = 0.05;
const DIRS = 16;
const PUSH_DIRS = 8;
/** steering directions (unit vectors), plus "let go" at the end */
const CAND: [number, number][] = [];
for (let i = 0; i < DIRS; i++) CAND.push([Math.cos((i / DIRS) * Math.PI * 2), Math.sin((i / DIRS) * Math.PI * 2)]);
CAND.push([0, 0]);
/** px: a bear holding Weight is kept at this distance (a touch hands it over), a bear holding Lightning is fled from */
const TOUCH_AVOID = 95;

export class SumoPolicy implements Policy {
  private sim: Body = { x: 0, y: 0, vx: 0, vy: 0 };
  /** standing error, re-drawn every so often (a person does not stand exactly where they mean to) */
  private err = { x: 0, y: 0, until: 0 };

  constructor(private readonly P: Record<string, number>, private readonly rng: () => number) {}

  decide(w: World, nowMs: number): Decision {
    const P = this.P;
    const me = w.me;
    if (!me) return idle();
    if (me.wet) return idle('climb');
    if (nowMs >= this.err.until) {
      this.err = { x: jitter(this.rng) * P.noise, y: jitter(this.rng) * P.noise, until: nowMs + 500 };
    }
    const target = this.carryTarget(w, me) ?? this.pickTarget(w, me);
    const d = idle('move');
    d.target = target?.id ?? null;

    // where it wants to end up: behind the target, on the side away from the edge the target is closest to
    let sx = C;
    let sy = C;
    if (target && (target as { touch?: boolean }).touch) {
      sx = target.x;
      sy = target.y;
    } else if (target) {
      const stand = target.r + me.r + DASH_REACH * 0.55 * P.dashRange;
      sx = target.x - target.ux * stand + this.err.x;
      sy = target.y - target.uy * stand + this.err.y;
    }

    const steps = Math.max(2, Math.round(P.lookahead / DT));
    let bestCost = Infinity;
    let bestI = CAND.length - 1;
    for (let i = 0; i < CAND.length; i++) {
      const c = this.score(w, me, CAND[i][0], CAND[i][1], steps, sx, sy, target !== null);
      if (c < bestCost) {
        bestCost = c;
        bestI = i;
      }
    }
    d.mx = CAND[bestI][0];
    d.my = CAND[bestI][1];
    d.cost = bestCost;
    d.info.cost = Math.round(bestCost);

    if (me.st >= DASH_COST && me.fx !== 'freeze' && !me.bomb && me.carry !== 'lightning') this.considerDash(w, me, d);
    return d;
  }

  /**
   * Weight in hand: run into the nearest rival (a touch passes it on) before the countdown ends; the closer the end, the
   * less it cares for the edge. Lightning on a rival: take it. Only at the levels that know how (`carry`).
   */
  private carryTarget(w: World, me: WBear): (WBear & { ux: number; uy: number; touch: true }) | null {
    const P = this.P;
    if (P.carry <= 0 || me.carry === 'lightning') return null;
    let pick: WBear | null = null;
    let bestD = Infinity;
    for (const r of w.rivals) {
      if (r.wet || r.inv || r.fx === 'dismounted') continue;
      if (me.carry !== 'weight' && !(r.carry === 'lightning' && !me.carry)) continue;
      const dist = Math.hypot(r.x - me.x, r.y - me.y);
      if (dist < bestD) {
        bestD = dist;
        pick = r;
      }
    }
    if (!pick) return null;
    // the pass cooldown of whoever just received it: aim where it will be
    const lead = Math.min(0.3, bestD / 400);
    return { ...pick, x: pick.x + pick.vx * lead, y: pick.y + pick.vy * lead, ux: 0, uy: 0, touch: true };
  }

  /** the rival easiest to push out, and the direction to push it */
  private pickTarget(w: World, me: WBear): (WBear & { ux: number; uy: number }) | null {
    let best: (WBear & { ux: number; uy: number }) | null = null;
    let bestScore = Infinity;
    for (const r of w.rivals) {
      if (r.wet) {
        // camping: it climbs back onto the rim (edge - 45 at its angle), stunned for a moment, with the edge right behind
        if (!this.P.camp) continue;
        const a = Math.atan2(r.y - C, r.x - C);
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const back = Math.max(40, polarEdge(w.sectors, a) - 45);
        const camp = { ...r, x: C + ux * back, y: C + uy * back, vx: 0, vy: 0, ux, uy };
        const score = Math.hypot(camp.x - me.x, camp.y - me.y) * 0.5 - 50 * this.P.camp;
        if (score < bestScore) {
          bestScore = score;
          best = camp;
        }
        continue;
      }
      let rd = Infinity;
      let ux = 0;
      let uy = 0;
      for (let k = 0; k < PUSH_DIRS; k++) {
        const a = (k / PUSH_DIRS) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const dist = rayToEdge(w.sectors, r.x, r.y, cx, cy, r.r, 400, w.wall);
        if (dist < rd) {
          rd = dist;
          ux = cx;
          uy = cy;
        }
      }
      const score = rd + Math.hypot(r.x - me.x, r.y - me.y) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = { ...r, ux, uy };
      }
    }
    return best;
  }

  /** cost of steering (cx, cy) for `steps` ticks of DT */
  private score(w: World, me: WBear, cx: number, cy: number, steps: number, sx: number, sy: number, hunting: boolean): number {
    const P = this.P;
    const b = this.sim;
    b.x = me.x;
    b.y = me.y;
    b.vx = me.vx;
    b.vy = me.vy;
    const sp = P.speed;
    let cost = 0;
    let gotItem = false;
    for (let k = 1; k <= steps; k++) {
      step(b, cx * sp, cy * sp, DT, w.move);
      const t = k * DT;
      const m = margin(w.sectors, b.x, b.y, me.r);
      if (m < P.edgeMargin && wallUp(w.wall, b.x, b.y)) { /* the wall holds at walking speed */ }
      else if (m < 0) cost += 500 - m * 4;
      else if (m < P.edgeMargin) cost += 40 * ((P.edgeMargin - m) / P.edgeMargin) ** 2;
      // in a rival's dash reach with the edge behind: dodge (checked half-way and at the end, it is the costly part)
      if (P.dodge > 0 && (k === steps || k === steps >> 1)) {
        for (const r of w.rivals) {
          if (r.wet || r.st < DASH_COST - 0.1) continue;
          const rp = coast(r, t);
          const dist = Math.hypot(b.x - rp.x, b.y - rp.y);
          const reach = DASH_REACH + r.r + me.r + 20;
          if (dist >= reach || dist < 1) continue;
          const back = rayToEdge(w.sectors, b.x, b.y, (b.x - rp.x) / dist, (b.y - rp.y) / dist, me.r, KNOCK + 30, w.wall);
          cost += P.dodge * 60 * (1 - back / (KNOCK + 30)) * (1 - dist / reach);
        }
      }
      for (const bo of w.bolts) {
        if (t >= bo.tOn - 0.2 && t <= bo.tOn + BOLT_ON && Math.abs(boltSide(bo.a, bo.d, b.x, b.y)) < BOLT_HALF + me.r + 12) cost += 300;
      }
      for (const f of w.flying) {
        if (Math.hypot(f.x + f.vx * t - b.x, f.y + f.vy * t - b.y) < BOMB_BLAST + me.r + 15) cost += 250;
      }
      if (!gotItem && P.items > 0) {
        for (const it of w.items) {
          if (Math.hypot(it.x - b.x, it.y - b.y) > ITEM_R + me.r) continue;
          gotItem = true;
          cost -= me.bomb ? 0 : 30 * P.items;
        }
        // the item beam: an unknown power-up, so a small pull, or a push away when it only gives bad ones
        if (!gotItem && w.beam && Math.hypot(w.beam.x - b.x, w.beam.y - b.y) < w.beam.r + me.r * 0.5) {
          gotItem = true;
          cost += (w.beam.bad ? 25 : -15) * P.items;
        }
      }
    }
    // keep clear of a Weight (a touch hands it over) and, holding Lightning, of everyone who could take it
    if (P.carry > 0 && (me.carry === 'lightning' || !me.carry)) {
      for (const r of w.rivals) {
        if (r.wet) continue;
        const bad = me.carry === 'lightning' || r.carry === 'weight';
        if (!bad) continue;
        const dist = Math.hypot(b.x - r.x - r.vx * (steps * DT), b.y - r.y - r.vy * (steps * DT));
        if (dist < TOUCH_AVOID + r.r + me.r) cost += P.carry * 120 * (1 - dist / (TOUCH_AVOID + r.r + me.r));
      }
    }
    // bolts that fire after the horizon: it will still be standing about there
    const tEnd = steps * DT;
    for (const bo of w.bolts) {
      if (bo.tOn > tEnd && Math.abs(boltSide(bo.a, bo.d, b.x, b.y)) < BOLT_HALF + me.r + 20) cost += 200;
    }
    // where it ends up: near the pushing spot (or the centre when there is nobody to push)
    const toSpot = Math.hypot(b.x - sx, b.y - sy);
    cost += hunting ? toSpot * 0.15 * P.aggro : toSpot * 0.05;
    cost += Math.hypot(b.x - C, b.y - C) * 0.02;
    return cost;
  }

  private considerDash(w: World, me: WBear, d: Decision): void {
    const P = this.P;
    // rescue: sliding off with nothing else to stop it, dash back towards the centre
    const slide = coast(me, 0.35);
    if (P.dodge >= 0.5 && margin(w.sectors, slide.x, slide.y, me.r) < 0 && !wallUp(w.wall, slide.x, slide.y)) {
      d.dash = true;
      d.aim = Math.atan2(C - me.y, C - me.x);
      d.mode = 'rescue';
      return;
    }
    if (!P.dash) return;
    let bestAlign = -1;
    let bestA = 0;
    for (const r of w.rivals) {
      // a touch from a Weight holder would hand it over: only dash at one while we hold a Weight ourselves
      if (r.wet || r.fx === 'freeze' || (r.carry === 'weight' && me.carry !== 'weight')) continue;
      const dist0 = Math.hypot(r.x - me.x, r.y - me.y);
      const t = dist0 / 760;
      const px = r.x + r.vx * t;
      const py = r.y + r.vy * t;
      const dist = Math.hypot(px - me.x, py - me.y);
      if (dist - r.r - me.r > DASH_REACH * P.dashRange || dist < 1) continue;
      const ux = (px - me.x) / dist;
      const uy = (py - me.y) / dist;
      // a teammate in the way would take the hit
      if (w.allies.some((a) => !a.wet && (a.x - me.x) * ux + (a.y - me.y) * uy > 0 && Math.hypot(a.x - me.x, a.y - me.y) < dist)) continue;
      const back = rayToEdge(w.sectors, px, py, ux, uy, r.r, KNOCK * 1.5, w.wall);
      const align = 1 - back / (KNOCK * 1.5);
      if (align < P.dashAlign) continue;
      // if it misses, it must not slide out itself
      const miss = DASH_REACH + 40;
      if (margin(w.sectors, me.x + ux * miss, me.y + uy * miss, me.r) < 15) continue;
      if (align > bestAlign) {
        bestAlign = align;
        bestA = Math.atan2(uy, ux);
      }
    }
    if (bestAlign < 0) return;
    const dist = 120;
    d.dash = true;
    d.aim = bestA + clamp((jitter(this.rng) * P.noise) / dist, -0.6, 0.6);
    d.mode = 'dash';
    d.info.align = +bestAlign.toFixed(2);
  }
}
