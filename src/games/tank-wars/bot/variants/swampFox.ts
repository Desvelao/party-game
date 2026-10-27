// Swamp Fox: boats (faster), mines that go off when a boat touches them, and a shield: a2 held for SHIELD_HOLD s
// raises it (drains in `shieldTime`), a shorter press drops a mine instead. The bot raises the shield when an enemy
// shot will reach it later than the hold takes, and keeps it up (no firing) until the shot is gone.
import { SHIELD_HOLD, SHOT_R, TANK_R } from '../physics';
import type { Decision } from '../policy/types';
import type { World } from '../world';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { maze: false, swamp: true };

/** the shield is worth it for a shot that hits within this many s (and after the hold) */
const WINDOW = 1.1;

export const create = (): VariantAdapter => {
  let holdSince = -1;
  return {
    refine(w: World, d: Decision, P: Record<string, number>, nowMs: number): void {
      const me = w.me;
      if (!me || !P.shield) return;
      let hitIn = Infinity;
      for (const s of w.shots) {
        // closest approach to where we stand (the shield is for the shots it cannot dodge)
        const rx = me.x - s.x;
        const ry = me.y - s.y;
        const v2 = s.vx * s.vx + s.vy * s.vy;
        const t = (rx * s.vx + ry * s.vy) / v2;
        if (t <= 0 || t > s.tMax) continue;
        const miss = Math.hypot(rx - s.vx * t, ry - s.vy * t);
        if (miss < TANK_R + SHOT_R + 6) hitIn = Math.min(hitIn, t);
      }
      const want = me.shield > 0.25 && hitIn > SHIELD_HOLD * (1.1 - 0.5 * P.shield) && hitIn < WINDOW;
      // once started, hold at least the shield time: a shorter hold drops a mine
      const keep = holdSince >= 0 && (nowMs - holdSince < SHIELD_HOLD * 1000 + 80 || (hitIn < WINDOW && me.shield > 0));
      if (want || keep) {
        if (holdSince < 0) holdSince = nowMs;
        d.holdA2 = true;
        d.fire = false;
        d.mine = false;
        d.info.shield = 'up';
      } else holdSince = -1;
    },
  };
};
