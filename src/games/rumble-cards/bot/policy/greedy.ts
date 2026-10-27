// Baseline for A/B runs: what the balance tool's greedy bot does (server/bot.ts), the first card at the current aim.
import type { World } from '../world';
import type { Plan, Policy } from './types';

export class GreedyPolicy implements Policy {
  next(w: World): Plan | null {
    if (!w.myTurn || !w.hand.length) return null;
    if (w.state.purge > 0) return { kind: 'discard', card: 0, why: 'first' };
    return { kind: 'play', card: 0, target: w.state.aim, why: 'first', value: 0 };
  }
}
