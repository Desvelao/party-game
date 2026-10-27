// Predictive policy: project every ball to our paddle plane (with bounces), pick the one to take, put the paddle
// where the hit sends the ball at the weakest opponent, and boost to save or to score.
import { clamp } from '../../../../core/shared/kit/util';
import { H, MAX_ANGLE, PADDLE_SPEED, PADDLE_T, advance, contactY, project } from '../physics';
import type { World } from '../world';
import type { Decision, Policy, Threat } from './types';

export class PredictivePolicy implements Policy {
  constructor(private readonly P: Record<string, number>, private readonly rng: () => number) {}

  decide(w: World, nowMs: number): Decision {
    const P = this.P;
    const me = w.me;
    const out: Decision = { mx: 0, smash: false, threats: [], chosen: null, target: 0, info: {} };
    if (!me || !me.alive) return out;

    const age = clamp((nowMs - w.recvMs) / 1000, 0, P.maxAge);
    const pos = me.pos + me.vel * age;
    const half = me.len / 2;
    const lo = me.laneL + half;
    const hi = me.laneR - half;

    // ---- threats ---------------------------------------------------------------------------------------------
    const threats: Threat[] = [];
    for (const b of w.balls) {
      if (!b.known) continue;
      const now = age > 0 ? advance(b, age, w.env) : b;
      const imp = project(now, w.env, P.horizon);
      if (!imp || imp.bounces > P.maxBounces) continue;
      const travel = Math.max(0, Math.abs(imp.x - pos) - half * 0.7);
      // the paddle follows mx with a lag of about 1/14 s, then runs at 620 px/s
      const need = travel / (PADDLE_SPEED * 0.9) + (travel > 0 ? 0.07 : 0);
      threats.push({ id: b.id, t: imp.t, x: imp.x, slack: imp.t - need, bounces: imp.bounces });
    }
    threats.sort((a, b) => a.t - b.t);
    out.threats = threats;

    // ---- which ball to take: the soonest one we can still reach, else the soonest one -----------------------------
    const chosen = threats.find((t) => t.slack >= -0.03) ?? threats[0] ?? null;
    out.chosen = chosen?.id ?? null;

    let target = 0;
    if (chosen) {
      // aim: angle the return towards the opponent with the fewest lives
      let aimRel = -1;
      for (let rel = 1; rel < 4; rel++) {
        if (!w.alive[rel]) continue;
        if (aimRel < 0 || w.lives[rel] < w.lives[aimRel] || (w.lives[rel] === w.lives[aimRel] && rel === 2)) aimRel = rel;
      }
      let offset = 0;
      if (aimRel > 0 && P.aim > 0) {
        const tx = aimRel === 1 ? -H : aimRel === 3 ? H : 0;
        const ty = aimRel === 2 ? -H : 0;
        const hy = contactY(w.env.r);
        const angle = Math.atan2(tx - chosen.x, hy - ty);
        const spare = clamp(chosen.slack / P.aimSlack, 0, 1);
        offset = clamp(angle / MAX_ANGLE, -P.aimMax, P.aimMax) * P.aim * spare;
        out.info.aimRel = aimRel;
      }
      out.info.offset = +offset.toFixed(2);
      target = chosen.x - offset * (half + w.env.r * 0.6);
    } else if (w.balls.length) {
      let sum = 0;
      for (const b of w.balls) sum += b.x;
      target = (sum / w.balls.length) * P.idleFollow;
    }
    if (P.noise > 0) target += (this.rng() - 0.5) * 2 * P.noise;
    target = clamp(target, lo, hi);
    out.target = target;

    // ---- paddle control --------------------------------------------------------------------------------------------
    const err = target - pos;
    out.mx = Math.abs(err) <= P.deadband && Math.abs(me.vel) < 40 ? 0 : clamp((err * P.gain) / PADDLE_SPEED, -1, 1);

    // ---- smash -----------------------------------------------------------------------------------------------------
    if (P.smash > 0 && me.ready >= 0.999) {
      const R = w.boostRadius;
      const faceY = H - PADDLE_T;
      for (const b of w.balls) {
        const dist = Math.hypot(b.x - pos, b.y - faceY);
        if (b.vy <= 0 || dist > R) continue;
        const th = threats.find((t) => t.id === b.id);
        const lateral = Math.abs(b.x - pos);
        const unreachable = th ? Math.abs(th.x - pos) > half + w.env.r * 0.6 && th.t < 0.3 && th.slack < 0 : false;
        if (P.smashSave > 0 && unreachable) {
          out.smash = true;
          out.info.smash = 'save';
        } else if (dist <= P.smashDist * R && lateral <= half + w.env.r) {
          out.smash = true;
          out.info.smash = 'offence';
        }
        if (out.smash) break;
      }
    }
    return out;
  }
}
