// Headless Spring Showdown rounds with the bot in every seat (no server, no network): for tests and for comparing
// bots (`variantAware: 0` plays a variant as Spring Painter). See kit/botsim.ts for what the bots see.
import { playBots, type BotSimOptions, type BotSimResult } from '../../../core/shared/kit/botsim';
import { mulberry32 } from '../../../core/shared/kit/util';
import { POGO_VARIANTS, createSpringShowdown } from '../server/create';
import { PogoBot } from './index';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';

export interface SimSeat {
  level?: string;
  params?: Record<string, number>;
  policy?: 'planner' | 'greedy';
  allies?: number[];
}

export function playRound(variant: string, seats: SimSeat[], opts: BotSimOptions & { options?: Record<string, number>; seed?: number } = {}): BotSimResult {
  const v = POGO_VARIANTS.find((x) => x.id === variant);
  if (!v) throw new Error(`no variant ${variant}`);
  const seed = opts.seed ?? 1;
  const game = createSpringShowdown(v, { ...opts.options }, mulberry32(seed));
  const ids = seats.map((_, i) => `p${i}`);
  const tickRate = opts.tickRate ?? 60;
  const bots = seats.map((s, i) => {
    const params = { ...DEFAULT_PARAMS, ...(s.level ? LEVELS[s.level] : {}), ...s.params };
    return new PogoBot({ selfId: ids[i], name: ids[i], tickRate, networkRate: tickRate / (opts.snapEvery ?? 3), seed: seed * 31 + i, params, allies: (s.allies ?? []).map((k) => ids[k]) }, s.policy ?? 'planner');
  });
  return playBots(game, ids, bots, opts);
}
