// Baseline for A/B runs: walk at the nearest rival, dash when close, step back from the edge.
import { C, DASH_COST, margin } from '../physics';
import type { World } from '../world';
import { idle, type Decision, type Policy } from './types';

export class GreedyPolicy implements Policy {
  decide(w: World): Decision {
    const me = w.me;
    if (!me || me.wet) return idle(me?.wet ? 'climb' : 'idle');
    const d = idle('move');
    let tx = C;
    let ty = C;
    let best = Infinity;
    for (const r of w.rivals) {
      if (r.wet) continue;
      const dist = Math.hypot(r.x - me.x, r.y - me.y);
      if (dist < best) {
        best = dist;
        tx = r.x;
        ty = r.y;
        d.target = r.id;
      }
    }
    if (margin(w.sectors, me.x, me.y, me.r) < 40) {
      tx = C;
      ty = C;
      d.target = null;
    }
    const a = Math.atan2(ty - me.y, tx - me.x);
    d.mx = Math.cos(a);
    d.my = Math.sin(a);
    if (d.target && best < 150 && me.st >= DASH_COST && !me.bomb) {
      d.dash = true;
      d.aim = a;
    }
    return d;
  }
}
