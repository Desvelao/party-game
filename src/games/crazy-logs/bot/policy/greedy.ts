// Baseline for A/B runs: the balance tool's greedy hopper (server/bot.ts), which assumes the default layout.
import { greedyLogs } from '../../server/bot';
import type { World } from '../world';
import { idle, type Decision, type Policy, type Self } from './types';

export class GreedyPolicy implements Policy {
  constructor(private readonly selfId: string) {}

  decide(env: World, _self: Self): Decision {
    const i = greedyLogs(env.state, this.selfId);
    const d = idle(i.a1 ? 'hop' : 'walk');
    d.mx = i.mx;
    d.my = i.my;
    d.hop = i.a1;
    return d;
  }
}
