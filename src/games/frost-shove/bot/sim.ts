// Headless Frost Shove rounds with the bot in every seat (no server, no network): for tests and for comparing bots
// (`variantAware: 0` plays a variant as Frost Shove). See kit/botsim.ts for what the bots see.
import { playBots, type BotSimOptions, type BotSimResult } from '../../../core/shared/kit/botsim';
import { POLAR_VARIANTS, createFrostShove } from '../server/create';
import { mulberry32 } from '../../../core/shared/kit/util';
import { FrostShoveBot } from './index';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';

export interface SimSeat {
  /** a LEVELS key (default: full strength) */
  level?: string;
  params?: Record<string, number>;
  policy?: 'sumo' | 'greedy';
  /** teammates (seat indexes) */
  allies?: number[];
}

export function playRound(variant: string, seats: SimSeat[], opts: BotSimOptions & { options?: Record<string, number>; seed?: number } = {}): BotSimResult {
  const v = POLAR_VARIANTS.find((x) => x.id === variant);
  if (!v) throw new Error(`no variant ${variant}`);
  const seed = opts.seed ?? 1;
  const game = createFrostShove(v, { ...opts.options }, mulberry32(seed));
  const ids = seats.map((_, i) => `p${i}`);
  const tickRate = opts.tickRate ?? 60;
  const bots = seats.map((s, i) => {
    const params = { ...DEFAULT_PARAMS, ...(s.level ? LEVELS[s.level] : {}), ...s.params };
    const allies = (s.allies ?? []).map((k) => ids[k]);
    return new FrostShoveBot({ selfId: ids[i], name: ids[i], tickRate, networkRate: tickRate / (opts.snapEvery ?? 3), seed: seed * 31 + i, params, allies }, s.policy ?? 'sumo');
  });
  return playBots(game, ids, bots, opts);
}
