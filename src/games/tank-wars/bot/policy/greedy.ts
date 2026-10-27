// Baseline for A/B runs: drive at the nearest rival with the cannon held.
import type { World } from '../world';
import { idle, type Decision, type Policy } from './types';

export class GreedyPolicy implements Policy {
  decide(w: World): Decision {
    const me = w.me;
    if (!me) return idle();
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const r of w.rivals) {
      const d = Math.hypot(r.x - me.x, r.y - me.y);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    const d = idle('attack');
    if (!best) return d;
    const a = Math.atan2(best.y - me.y, best.x - me.x);
    d.mx = Math.cos(a);
    d.my = Math.sin(a);
    d.fire = true;
    return d;
  }
}
