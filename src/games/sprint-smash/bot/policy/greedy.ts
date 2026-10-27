// Baseline for A/B runs: drive the middle of the track, throttle held, use items at once.
import { DASH_MID, point } from '../physics';
import type { World } from '../world';
import { idle, type Decision, type Policy } from './types';

export class GreedyPolicy implements Policy {
  decide(w: World): Decision {
    const me = w.me;
    if (!me) return idle();
    const t = point(me.a + 0.35, DASH_MID);
    const a = Math.atan2(t.y - me.y, t.x - me.x);
    const d = idle('greedy');
    d.mx = Math.cos(a);
    d.my = Math.sin(a);
    d.throttle = true;
    d.press = !!me.item;
    d.line = DASH_MID;
    return d;
  }
}
