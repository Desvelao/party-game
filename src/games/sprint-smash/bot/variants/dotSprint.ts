// Dot Sprint adapter: the missile flies straight along the craft's heading (fired with a2), so aiming means turning
// the craft at the rival and pressing when the line to it is clear. The rest (open edges, berry bar) is in the racer.
import { MISSILE_R } from '../physics';
import type { Decision } from '../policy/types';
import type { World } from '../world';
import type { Rules, VariantAdapter } from './types';

/** a rival is only worth aiming at inside this range (u) and when it is not behind */
const AIM_RANGE = 420;

export const create = (rules: Rules): VariantAdapter => ({
  rules,
  refine(w: World, d: Decision, P: Record<string, number>): void {
    const me = w.me;
    d.press = false;
    if (!me || me.item !== 'missile' || me.stun || me.fall || P.items <= 0) return;
    let best: { dx: number; dy: number; dist: number } | null = null;
    for (const r of w.rivals) {
      if (r.air > 0 || r.fall) continue;
      const dx = r.x - me.x;
      const dy = r.y - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist > AIM_RANGE || dist < 1) continue;
      // ahead of us only
      if (dx * Math.cos(me.f) + dy * Math.sin(me.f) <= 0) continue;
      if (!best || dist < best.dist) best = { dx, dy, dist };
    }
    if (!best) return;
    const want = Math.atan2(best.dy, best.dx);
    d.mx = Math.cos(want);
    d.my = Math.sin(want);
    d.mode = 'aim';
    let off = Math.abs(want - me.f) % (Math.PI * 2);
    if (off > Math.PI) off = Math.PI * 2 - off;
    if (off < Math.atan2(MISSILE_R * (0.4 + 0.5 * P.items), best.dist) + 0.04) d.press = true;
    if (d.press) d.mode = 'missile';
  },
});
