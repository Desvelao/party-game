// Sand Orb: the first button is a magnet (hold = pull, catch up to two balls, release = boosted launch) and the
// boost moves to the second button. Free balls are slow and decay (drag), which shows in `physics`.
//
// The bot pulls when a ball is coming at it, then, holding the ball, moves the paddle at the speed that sends the
// launch towards the weakest opponent (the server aims a release by the paddle's velocity) and lets go.
import { clamp } from '../../../../core/shared/kit/util';
import { H, MAX_ANGLE, PADDLE_SPEED, PADDLE_T, contactY } from '../physics';
import { sandOrb } from '../../server/variants/sandOrb';
import type { Decision } from '../policy/types';
import type { World } from '../world';
import { speedLimits } from './limits';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { drag: sandOrb.drag, ...speedLimits(sandOrb) };

/** seconds the server lets a hold last (option `holdTime`, default 3) */
const HOLD_TIME = sandOrb.magnet?.holdTime ?? 3;
/** the server aims a release by 0.4 x (paddle speed / max speed) of the max angle */
const VEL_AIM = 0.4;
/** least seconds to hold before letting go, so the paddle has time to reach the aiming speed */
const MIN_HOLD = 0.4;
/** longest we keep pulling without a catch: the server locks the magnet after `holdTime` of that */
const MAX_PULL = 2;

export const create = (): VariantAdapter => {
  let pullSince = -1;
  let pause = 0;
  let wasHolding = false;
  /** per ball: did we decide to go for it with the magnet (so a level that uses it half the time does not flicker) */
  const pick = new Map<number, boolean>();

  return {
    boostButton: 'a2',
    refine(w: World, d: Decision, P: Record<string, number>, nowMs: number, rng: () => number): void {
      const m = w.magnet;
      const me = w.me;
      if (!m || !me || !me.alive) return;
      const holding = m.held > 0;
      // a hold that ran out released the balls with the button still down: the server wants it released first
      if (wasHolding && !holding) pause = nowMs + 250;
      wasHolding = holding;

      if (holding) {
        const elapsed = (1 - Math.max(0, m.holdLeft)) * HOLD_TIME;
        const urgent = d.threats.find((t) => t.t < 0.9 && t.slack < 0.25);
        // the opponent to send it at: the weakest living side (shared with the aim of the normal return)
        let rel = -1;
        for (let r = 1; r < 4; r++) {
          if (!w.alive[r]) continue;
          if (rel < 0 || w.lives[r] < w.lives[rel] || (w.lives[r] === w.lives[rel] && r === 2)) rel = r;
        }
        let ratio = 0;
        if (rel > 0) {
          const tx = rel === 1 ? -H : rel === 3 ? H : 0;
          const ty = rel === 2 ? -H : 0;
          const angle = Math.atan2(tx - me.pos, contactY(w.env.r) - ty);
          ratio = clamp(angle / MAX_ANGLE / VEL_AIM, -1, 1) * P.aim;
        }
        const half = me.len / 2;
        const edge = ratio > 0 ? me.laneR - half - me.pos : me.pos - me.laneL - half;
        const synced = Math.abs(me.vel - ratio * PADDLE_SPEED) < 90;
        const release = !!urgent || elapsed >= P.magnetHold || (elapsed >= MIN_HOLD && synced) || (ratio !== 0 && edge < 40);
        d.hold = !release;
        if (!urgent) d.mx = clamp(ratio, -1, 1);
        d.info.magnet = release ? 'release' : 'aim';
        return;
      }

      if (!P.magnet || nowMs < pause) {
        d.hold = false;
        pullSince = -1;
        return;
      }
      // a ball heading for us and inside the pull
      const faceY = H - PADDLE_T;
      let want = false;
      for (const b of w.balls) {
        if (b.vy <= 0 || Math.hypot(b.x - me.pos, b.y - faceY) > m.range * 0.9) continue;
        let go = pick.get(b.id);
        if (go === undefined) {
          go = rng() < P.magnet;
          pick.set(b.id, go);
        }
        if (go) want = true;
      }
      if (want && pullSince < 0) pullSince = nowMs;
      if (want && nowMs - pullSince > MAX_PULL * 1000) {
        want = false;
        pause = nowMs + 400;
      }
      if (!want) pullSince = -1;
      d.hold = want;
      if (want) d.info.magnet = 'pull';
      if (pick.size > 64) pick.clear();
    },
  };
};
