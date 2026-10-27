// Wild Frenzy: bombs. Walking over one picks it up; the action button then throws it instead of dashing (560 px/s,
// 0.9 s fuse, explodes on the first rival it touches). Two hits put a bear out. The shared policy dodges the flying
// ones (world.flying) and goes for bomb pick-ups (items); this adapter throws the one it holds.
import { clamp } from '../../../../core/shared/kit/util';
import { jitter } from '../../../../core/shared/kit/humanize';
import { BOMB_BLAST, BOMB_LIFE, BOMB_SPEED } from '../physics';
import type { Decision } from '../policy/types';
import type { World } from '../world';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { bombs: true };

/** a throw is only worth it inside this share of the bomb's range */
const RANGE = BOMB_SPEED * BOMB_LIFE * 0.8;

export const create = (): VariantAdapter => ({
  refine(w: World, d: Decision, P: Record<string, number>, _nowMs: number, rng: () => number): void {
    const me = w.me;
    if (!me?.bomb) return;
    // the button throws now: never dash while holding a bomb
    d.dash = false;
    let best: { x: number; y: number; d: number } | null = null;
    for (const r of w.rivals) {
      // a rival in the water or under hit protection takes nothing from the blast
      if (r.fall > 0 || r.inv) continue;
      const dist = Math.hypot(r.x - me.x, r.y - me.y);
      if (dist > RANGE || (best && dist >= best.d)) continue;
      // lead: where the rival will be when the bomb gets there
      const t = (dist / BOMB_SPEED) * clamp(P.bombLead, 0, 1);
      const x = r.x + r.vx * t;
      const y = r.y + r.vy * t;
      // the blast hurts everyone but the thrower: not at a rival standing next to a teammate
      if (w.allies.some((q) => Math.hypot(q.x - x, q.y - y) < BOMB_BLAST + q.r)) continue;
      best = { x, y, d: dist };
    }
    if (!best) return;
    const err = (1 - clamp(P.bombLead, 0, 1)) * 0.25 * jitter(rng);
    const a = Math.atan2(best.y - me.y, best.x - me.x) + err;
    d.aim = a;
    d.press = true;
    d.info.bomb = 'throw';
  },
});
