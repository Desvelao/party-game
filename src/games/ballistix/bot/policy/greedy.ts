// Baseline: the port of the server's greedyBalls. Slide under the ball deepest in our half, boost when it is close.
import { H } from '../physics';
import type { World } from '../world';
import type { Decision, Policy } from './types';

export class GreedyPolicy implements Policy {
  decide(w: World): Decision {
    const idle: Decision = { mx: 0, smash: false, threats: [], chosen: null, target: 0, info: { policy: 'greedy' } };
    if (!w.me || !w.me.alive) return idle;
    let best: (typeof w.balls)[number] | null = null;
    for (const b of w.balls) if (!best || b.y > best.y) best = b;
    if (!best) return idle;
    const d = best.x - w.me.pos;
    return { ...idle, mx: Math.abs(d) < 8 ? 0 : d > 0 ? 1 : -1, smash: best.y > H - 100 && w.me.ready >= 0.999, chosen: best.id, target: best.x };
  }
}
