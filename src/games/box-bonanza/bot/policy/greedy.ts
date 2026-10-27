// Baseline for A/B runs: walk at the nearest crate (pick it up) or rival (throw at it, kick it).
import type { World } from '../world';
import { idle, type Decision, type Policy } from './types';

export class GreedyPolicy implements Policy {
  decide(w: World): Decision {
    const me = w.me;
    if (!me) return idle();
    const d = idle('greedy');
    let tx = me.x;
    let ty = me.y;
    let best = Infinity;
    const near = (x: number, y: number) => Math.hypot(x - me.x, y - me.y);
    if (!me.hold) {
      for (const c of w.crates) if (!c.moving && c.k !== 'nitro' && near(c.x, c.y) < best) ((best = near(c.x, c.y)), (tx = c.x), (ty = c.y));
      d.act = me.target >= 0;
    }
    if (me.hold || best === Infinity) {
      best = Infinity;
      for (const r of w.rivals) if (near(r.x, r.y) < best) ((best = near(r.x, r.y)), (tx = r.x), (ty = r.y));
      if (me.hold && best < 300) d.act = true;
    }
    const a = Math.atan2(ty - me.y, tx - me.x);
    d.mx = Math.cos(a);
    d.my = Math.sin(a);
    d.kick = w.rivals.some((r) => near(r.x, r.y) < 70);
    return d;
  }
}
