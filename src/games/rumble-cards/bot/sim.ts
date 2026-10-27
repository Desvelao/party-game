// Headless Rumble Cards rounds with the bot in every seat (no server, no network): for tests and for comparing bots.
// The bots get their hands through onPrivate, as on the wire. See kit/botsim.ts.
import { playBots, type BotSimOptions, type BotSimResult } from '../../../core/shared/kit/botsim';
import { mulberry32 } from '../../../core/shared/kit/util';
import { applyOptions } from '../server/config';
import { RumbleCards } from '../server/RumbleCards';
import { RumbleCardsBot } from './index';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';

export interface SimSeat {
  level?: string;
  params?: Record<string, number>;
  policy?: 'planner' | 'greedy';
  allies?: number[];
}

/** `variant` is ignored (Rumble Cards has none); `heroes` fixes the hero of each seat (default: dealt at random) */
export function playRound(_variant: string, seats: SimSeat[], opts: BotSimOptions & { options?: Record<string, number>; seed?: number; heroes?: number[] } = {}): BotSimResult {
  const seed = opts.seed ?? 1;
  const game = new RumbleCards(applyOptions({ ...opts.options }), mulberry32(seed), opts.heroes);
  const ids = seats.map((_, i) => `p${i}`);
  const tickRate = opts.tickRate ?? 60;
  const bots = seats.map((s, i) => {
    const params = { ...DEFAULT_PARAMS, ...(s.level ? LEVELS[s.level] : {}), ...s.params };
    return new RumbleCardsBot({ selfId: ids[i], name: ids[i], tickRate, networkRate: tickRate / (opts.snapEvery ?? 3), seed: seed * 31 + i, params, allies: (s.allies ?? []).map((k) => ids[k]) }, s.policy ?? 'planner');
  });
  return playBots(game, ids, bots, { maxSeconds: 3600, ...opts });
}
