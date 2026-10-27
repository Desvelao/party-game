// Baseline for A/B runs: the balance tool's greedy painter (server/bot.ts).
import { greedyPogo } from '../../server/bot';
import type { World } from '../world';
import { idle, type Decision, type Policy } from './types';

export class GreedyPolicy implements Policy {
  constructor(private readonly selfId: string, private readonly rng: () => number) {}

  decide(w: World): Decision {
    const i = greedyPogo(w.state, this.selfId, this.rng);
    const d = idle('greedy');
    d.dir = i.mx > 0 ? 1 : i.mx < 0 ? 3 : i.my > 0 ? 2 : i.my < 0 ? 0 : -1;
    d.fire = i.a1 && !!w.me?.item;
    d.fireDir = w.me?.f ?? 0;
    return d;
  }
}
