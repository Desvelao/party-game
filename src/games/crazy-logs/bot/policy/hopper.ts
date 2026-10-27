// The Crazy Logs policy. A hop flies `hop` px towards the stick, so the stick's angle picks where along the river it
// lands (a slanted hop covers less of it): the bot picks a landing spot on the next log (or the far bank), offset
// from the middle so the landing cancels the log's spin, checks it is clear of jets, log ends and other players, and
// hops once the hop is ready. Until then it walks to where the hop reaches, against the spin of the log it is on.
import { clamp } from '../../../../core/shared/kit/util';
import { jitter } from '../../../../core/shared/kit/humanize';
import { HOP_TIME, JET_RADIUS, JET_WARN, LAND_ASSIST, LOGS_FINISH_Y, LOGS_LEFT, LOGS_RIGHT, LOGS_START_Y, PLAYER_R, WALK_SPEED } from '../physics';
import type { World } from '../world';
import { idle, type Decision, type Policy, type Self } from './types';

/** lowest y on the start bank (the server clamps walkers to LOGS_START_Y + 0.5 R) */
const BANK_TOP = LOGS_START_Y + PLAYER_R * 0.5 + 1;
/** x it likes to stay in: away from the log ends */
const LANE_MIN = LOGS_LEFT + 90;
const LANE_MAX = LOGS_RIGHT - 90;

export class HopperPolicy implements Policy {
  /** landing error, drawn once per hop target so it does not flicker */
  private err = 0;
  private errFor = -2;
  /** per jet (by position): did we notice its warning */
  private noticed = new Map<string, boolean>();
  /** where the last hop comes down (along the river) */
  private lastTy: number | null = null;

  constructor(private readonly P: Record<string, number>, private readonly rng: () => number) {}

  decide(env: World, self: Self, nowMs: number): Decision {
    const P = this.P;
    const { me, ground } = self;
    if (me.w > 0 || ground.kind === 'water' && me.h === 0) return idle();
    if (me.h > 0) return this.inAir(env, me.y);
    const D = env.hop;
    const rows = env.rows;
    const half = env.half;
    const row = ground.kind === 'log' ? ground.row : -1;
    const next = row + 1;
    const jets = this.visibleJets(env);

    // where it can stand: on a log, inside its edges; on the bank, its top
    let lo = BANK_TOP;
    let hi = 1000;
    /** the very far edge it can stand on (wide gaps need it) */
    let loEdge = BANK_TOP;
    if (row >= 0) {
      lo = rows[row].y - half + P.edgeMargin + 4;
      hi = rows[row].y + half - P.edgeMargin - 4;
      loEdge = rows[row].y - half + 3;
    }

    // where to land
    let ty: number;
    if (next >= rows.length) ty = LOGS_FINISH_Y - 20;
    else {
      const r = rows[next];
      // landing at offset o adds o * landImpulse to the spin: aim where that cancels it
      const o = clamp((-r.v / Math.max(30, env.landImpulse)) * P.spinAware, -0.6, 0.6);
      if (this.errFor !== next) {
        this.errFor = next;
        this.err = jitter(this.rng) * P.noise;
      }
      ty = clamp(r.y + o * half + this.err, r.y - half + P.edgeMargin, r.y + half - P.edgeMargin);
    }

    // wide gaps (few logs): the best it can do is the near edge of the next log, from the far edge of this one
    let wide = false;
    if (ty < lo - D * 0.98) {
      const nearEdge = next >= rows.length ? LOGS_FINISH_Y : rows[next].y + half;
      ty = Math.min(lo - D * 0.98, nearEdge + LAND_ASSIST - 3);
      wide = true;
    }
    const d = idle('walk');
    d.ty = ty;
    const dy = ty - me.y;
    const reach = Math.abs(dy) <= D * 0.99;
    let hopDir: [number, number] | null = null;
    if (reach) hopDir = this.pickSide(env, me.x, me.y, dy, D, jets);
    if (hopDir) {
      d.tx = me.x + hopDir[0] * D;
      if (self.readyMs > 0 && self.readyMs >= P.hesitate * 1000) {
        d.mx = hopDir[0];
        d.my = hopDir[1];
        d.hop = true;
        d.mode = 'hop';
        this.lastTy = me.y + hopDir[1] * D;
        return d;
      }
      d.mode = 'wait';
    }

    // walk: towards a spot the hop reaches from (or hold), against the log's drift, into the lane, away from jets
    const v = row >= 0 ? rows[row].v : 0;
    let goalY = me.y;
    if (!reach) goalY = ty + D * (wide ? 0.96 : 0.9);
    goalY = clamp(goalY, wide ? loEdge : lo, hi);
    // on a log: back towards the middle when the spin is about to carry us off an edge
    const drift = me.y + v * 0.3;
    if (row >= 0 && (drift < rows[row].y - half + 1 || drift > rows[row].y + half - 1)) {
      goalY = rows[row].y;
      d.mode = 'escape';
    }
    let goalX = clamp(me.x, LANE_MIN, LANE_MAX);
    for (const j of jets) {
      if (Math.abs(j.y - me.y) < JET_RADIUS && Math.abs(j.x - me.x) < JET_RADIUS + 30) goalX = j.x > me.x ? j.x - JET_RADIUS - 40 : j.x + JET_RADIUS + 40;
    }
    goalX = clamp(goalX, LOGS_LEFT + 40, LOGS_RIGHT - 40);
    // walk speed is WALK_SPEED; the log adds v along y
    const vy = clamp((goalY - me.y) * 6, -WALK_SPEED, WALK_SPEED) - v;
    const vx = clamp((goalX - me.x) * 4, -WALK_SPEED, WALK_SPEED);
    d.mx = Math.abs(goalX - me.x) < 2 ? 0 : clamp(vx / WALK_SPEED, -1, 1) * P.speed;
    // a small stick still moves: keep at least 0.15 until it is within a pixel (or it stops just short of the reach)
    d.my = clamp(vy / WALK_SPEED, -1, 1) * P.speed;
    if (Math.abs(goalY - me.y) >= 1 && Math.abs(d.my) < 0.15 && Math.abs(v) < 5) d.my = Math.sign(goalY - me.y) * 0.15;
    else if (Math.abs(d.my) < 0.03) d.my = 0;
    d.info.goalY = Math.round(goalY);
    return d;
  }

  /**
   * In the air the stick does nothing until the landing tick, when walking starts at once: hold it towards the middle
   * of the log it comes down on, so a landing near an edge (which spins the log that way) walks back in straight away.
   */
  private inAir(env: World, y: number): Decision {
    const d = idle('air');
    const ty = this.lastTy;
    if (ty === null || Math.abs(ty - y) > env.hop * 1.05) return d;
    let c: number | null = null;
    for (const r of env.rows) if (Math.abs(r.y - ty) <= env.half + LAND_ASSIST) c = r.y;
    if (c === null) return d;
    d.my = clamp(((c - ty) / env.half) * 2, -1, 1) * this.P.speed;
    if (Math.abs(d.my) < 0.2) d.my = 0;
    return d;
  }

  /** the hop direction (unit) that lands dy along the river on safe ground, or null */
  private pickSide(env: World, x: number, y: number, dy: number, D: number, jets: World['jets']): [number, number] | null {
    const P = this.P;
    const uy = dy / D;
    const ux = Math.sqrt(Math.max(0, 1 - uy * uy));
    let best: [number, number] | null = null;
    let bestCost = Infinity;
    // prefer heading back into the lane
    const pref = x < 500 ? 1 : -1;
    for (const side of [pref, -pref]) {
      const lx = x + side * ux * D;
      const ly = y + uy * D;
      if (ly > LOGS_FINISH_Y && (lx < LOGS_LEFT + 30 || lx > LOGS_RIGHT - 30)) continue;
      let cost = side === pref ? 0 : 1;
      if (lx < LANE_MIN || lx > LANE_MAX) cost += 2;
      // a jet erupting while it is in the air or just landed
      for (const j of jets) {
        const tErupt = j.e ? 0 : j.w * JET_WARN;
        if (tErupt < HOP_TIME + 0.6 && Math.hypot(j.x - lx, j.y - ly) < JET_RADIUS + 15) cost += 100;
      }
      for (const o of env.others) if (Math.hypot(o.x - lx, o.y - ly) < PLAYER_R * 2 + 10) cost += 5 * P.crowd;
      if (cost < bestCost) {
        bestCost = cost;
        best = [side * ux, uy];
      }
    }
    // a straight hop when there is no sideways room is already covered (ux = 0 for both); a jet everywhere: wait
    return bestCost >= 100 ? null : best;
  }

  /** jets whose warning it noticed (the level's jetAware share, decided once per jet) */
  private visibleJets(env: World): World['jets'] {
    if (!env.jets.length) return env.jets;
    const out: World['jets'] = [];
    for (const j of env.jets) {
      const key = `${Math.round(j.x)},${Math.round(j.y)}`;
      let seen = this.noticed.get(key);
      if (seen === undefined) {
        seen = this.rng() < this.P.jetAware;
        this.noticed.set(key, seen);
      }
      if (seen) out.push(j);
    }
    if (this.noticed.size > 32) this.noticed.clear();
    return out;
  }
}
