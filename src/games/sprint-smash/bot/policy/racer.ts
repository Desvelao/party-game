// The Sprint Smash policy. Laps run around the ring towards increasing angle and every craft moves at about the same
// speed, so the inner line is the shortest lap. Each decision tries a handful of lines (radii) for `lookahead`
// seconds: progress around the ring, minus the hazards met on the way (lava balls, barrels, slime blobs, missiles that
// are not ours; not the rods, which span the whole track) and plus the pick-ups collected; it steers at a point ahead on the best line. The
// throttle is held (holding it always is fastest: the gauge refills by itself). Items go off when they will hit: a
// missile at a rival ahead on its own radius (the missile keeps the radius it was fired at), a star at a rival close by.
import { inWallArc } from '../../shared/geometry';
import { DASH_CX, DASH_CY, DASH_MID, BALL_R, BARREL_R, BLOB_R, MISSILE_R, MISSILE_SPEED, PICKUP_R, PLAYER_R, R_HI, R_LO, STAR_RADIUS, point, wrap } from '../physics';
import type { Rules, VariantAdapter } from '../variants';
import type { WCraft, World } from '../world';
import { idle, type Decision, type Policy } from './types';

const DT = 0.1;
/** radial speed share: a craft can cross the track at about this fraction of its speed */
const CROSS = 0.55;
/** the tightest line it drives (the wall clamp is R_LO) */
const INNER_LINE = R_LO + 16;

export class RacerPolicy implements Policy {
  constructor(private readonly P: Record<string, number>, private readonly rng: () => number, private adapter: VariantAdapter) {}

  setAdapter(a: VariantAdapter): void {
    this.adapter = a;
  }

  decide(w: World, nowMs: number): Decision {
    const me = w.me;
    if (!me || me.fin || me.fall) return idle();
    const P = this.P;
    const R = this.adapter.rules;
    // the inner wall is the shortest lap, but scraping it costs speed every tick: keep a little off it
    const pref = DASH_MID + (INNER_LINE - DASH_MID) * P.line + Math.sin(nowMs / 900) * P.noise;
    // an open outer edge (a fall, not a wall): keep well inside it, a knock can push the craft out
    const outer = R.edgeWalls && !R.outerArc ? R_HI - 50 : R_HI - 14;
    const lines = [INNER_LINE, INNER_LINE + 30, DASH_MID, Math.min(DASH_MID + 30, outer), outer, pref];
    // holding a missile: line up with the rival ahead (the missile keeps our radius)
    const prey = me.item === 'missile' && !R.straightMissiles ? this.preyAhead(w, me, 2.2) : null;
    if (prey) lines.push(Math.min(R_HI - 20, Math.max(R_LO + 20, prey.r)));
    let best = pref;
    let bestCost = Infinity;
    for (const rc of lines) {
      const c = this.cost(w, me, R, rc, pref, prey);
      if (c < bestCost) {
        bestCost = c;
        best = rc;
      }
    }
    // steer at a point ahead on that line
    const v = Math.max(120, me.speed);
    const ahead = Math.max(60, v * 0.35) / Math.max(R_LO, me.r);
    // a straight line to a point ahead cuts inside the circle: aim a little wide so the chord stays on the line
    const t = point(me.a + ahead, best / Math.cos(ahead / 2));
    const ang = Math.atan2(t.y - me.y, t.x - me.x);
    const d = idle('race');
    d.mx = Math.cos(ang);
    d.my = Math.sin(ang);
    d.line = Math.round(best);
    d.cost = bestCost;
    // berry bar: nothing to burn without a load; otherwise the gauge refills by itself, so hold
    d.throttle = (nowMs % 1000) / 1000 < P.throttle && (!R.berryBar || me.e > 0.02);
    this.items(w, me, d);
    d.info.line = d.line;
    return d;
  }

  /** the nearest rival ahead within `maxGap` rad */
  private preyAhead(w: World, me: WCraft, maxGap: number): WCraft | null {
    let best: WCraft | null = null;
    let bg = maxGap;
    for (const r of w.rivals) {
      if (r.air > 0) continue;
      const gap = wrap(r.a - me.a);
      if (gap > 0.15 && gap < bg) {
        bg = gap;
        best = r;
      }
    }
    return best;
  }

  private cost(w: World, me: WCraft, R: Rules, rc: number, pref: number, prey: WCraft | null): number {
    const P = this.P;
    const s = w.state;
    const v = Math.max(120, me.speed);
    let a = me.a;
    let r = me.r;
    let cost = Math.abs(rc - pref) * 0.004;
    if (prey && Math.abs(rc - prey.r) < MISSILE_R) cost -= 0.8 * P.items;
    const steps = Math.max(2, Math.round(P.lookahead / DT));
    const got = new Set<number>();
    for (let k = 1; k <= steps; k++) {
      const t = k * DT;
      const dr = Math.max(-v * CROSS * DT, Math.min(v * CROSS * DT, rc - r));
      r = Math.max(R_LO, Math.min(R_HI, r + dr));
      // scraping a wall costs 3% of the speed every tick (open edges: the inner wall, and the outer one only on the top arc)
      if (R.edgeWalls ? r <= R_LO + 2 || (R.outerArc && r >= R_HI - 2 && inWallArc(wrap(a))) : r <= R_LO + 2 || r >= R_HI - 2) cost += 0.5;
      const along = Math.sqrt(Math.max(0, (v * DT) ** 2 - dr * dr));
      a += along / r;
      const x = DASH_CX + Math.cos(a) * r;
      const y = DASH_CY + Math.sin(a) * r;
      if (P.dodge > 0 && me.air <= 0) {
        let h = 0;
        for (const m of w.missiles) {
          // straight missiles fly on (the bounce is not modelled); ring ones follow their circle
          let mx: number;
          let my: number;
          if (m.vx !== undefined && m.vy !== undefined) {
            mx = m.x + m.vx * t;
            my = m.y + m.vy * t;
          } else {
            const ma = m.a + (MISSILE_SPEED / m.r) * t;
            mx = DASH_CX + Math.cos(ma) * m.r;
            my = DASH_CY + Math.sin(ma) * m.r;
          }
          if (Math.hypot(mx - x, my - y) < MISSILE_R + 6) h += 4;
        }
        // lava balls fly straight from the volcano
        if (R.volcano) for (const b of s.balls ?? []) if (Math.hypot(b.x + b.vx * t - x, b.y + b.vy * t - y) < BALL_R + PLAYER_R * 0.5 + 8) h += 3;
        if (R.toxic) {
          for (const b of s.barrels ?? []) if (b.on && Math.hypot(b.x - x, b.y - y) < BARREL_R + PLAYER_R * 0.5 + 8) h += 3;
          for (const b of w.blobs) if (Math.hypot(b.x + b.vx * t - x, b.y + b.vy * t - y) < BLOB_R + PLAYER_R * 0.5 + 8) h += 3;
        }
        // the rods reach across the whole track, so no line dodges them (Splash Sprint jumps over them: variants/splashSprint.ts)
        cost += h * P.dodge;
      }
      for (const pk of s.pickups) {
        if (got.has(pk.id) || Math.hypot(pk.x - x, pk.y - y) > PICKUP_R + PLAYER_R * 0.5) continue;
        got.add(pk.id);
        if (pk.k === 'fruit') cost -= (R.berryBar ? (me.e < 0.9 ? 1.5 : 0.5) : me.e < 0.8 || !me.boost ? 1.5 : 0.5) * P.items;
        else if (!me.item) cost -= 2 * P.items;
      }
    }
    // progress: radians gained around the ring
    return cost - wrap(a - me.a) * 4;
  }

  private items(w: World, me: WCraft, d: Decision): void {
    const P = this.P;
    if (!me.item || me.stun || P.items <= 0) return;
    if (me.item === 'missile' && this.adapter.rules.straightMissiles) return; // the variant adapter aims and fires it
    if (me.item === 'star') {
      if (w.rivals.some((r) => Math.hypot(r.x - me.x, r.y - me.y) < STAR_RADIUS * 0.85) && !w.allies.some((a) => Math.hypot(a.x - me.x, a.y - me.y) < STAR_RADIUS)) d.press = true;
    } else if (me.item === 'missile') {
      const prey = this.preyAhead(w, me, 2.5);
      const mr = Math.min(R_HI - 12, Math.max(R_LO + 12, me.r));
      if (prey && Math.abs(prey.r - mr) < MISSILE_R * (0.4 + 0.5 * P.items)) d.press = true;
      // a poor player fires it off soon after picking it up
      else if (this.rng() < (1 - P.items) * 0.03) d.press = true;
    }
    if (d.press) d.mode = me.item;
  }
}
