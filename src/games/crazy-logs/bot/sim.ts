// Headless Crazy Logs rounds with the bot in every seat (no server, no network): for tests and for comparing bots.
// See kit/botsim.ts for what the bots see.
import { playBots, type BotSimOptions, type BotSimResult } from '../../../core/shared/kit/botsim';
import { mulberry32 } from '../../../core/shared/kit/util';
import { applyOptions } from '../server/config';
import { CrazyLogs } from '../server/CrazyLogs';
import { CrazyLogsBot } from './index';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';

export interface SimSeat {
  level?: string;
  params?: Record<string, number>;
  policy?: 'hopper' | 'greedy';
}

/** `variant` is ignored (Crazy Logs has none); kept so every pack's sim has the same shape */
export function playRound(_variant: string, seats: SimSeat[], opts: BotSimOptions & { options?: Record<string, number | boolean>; seed?: number } = {}): BotSimResult {
  const seed = opts.seed ?? 1;
  const game = new CrazyLogs(applyOptions({ ...opts.options }), mulberry32(seed));
  const ids = seats.map((_, i) => `p${i}`);
  const tickRate = opts.tickRate ?? 60;
  const bots = seats.map((s, i) => {
    const params = { ...DEFAULT_PARAMS, ...(s.level ? LEVELS[s.level] : {}), ...s.params };
    return new CrazyLogsBot({ selfId: ids[i], name: ids[i], tickRate, networkRate: tickRate / (opts.snapEvery ?? 3), seed: seed * 31 + i, params }, s.policy ?? 'hopper');
  });
  return playBots(game, ids, bots, opts);
}
