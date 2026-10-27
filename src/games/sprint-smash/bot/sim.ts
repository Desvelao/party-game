// Headless Sprint Smash rounds with the bot in every seat (no server, no network): for tests and for comparing bots
// (`variantAware: 0` races every variant as Dot Sprint). See kit/botsim.ts for what the bots see.
import { playBots, type BotSimOptions, type BotSimResult } from '../../../core/shared/kit/botsim';
import { mulberry32 } from '../../../core/shared/kit/util';
import { DASH_VARIANTS, createSprintSmash } from '../server/create';
import { SprintSmashBot } from './index';
import { LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';

export interface SimSeat {
  level?: string;
  params?: Record<string, number>;
  policy?: 'racer' | 'greedy';
  allies?: number[];
}

export function playRound(variant: string, seats: SimSeat[], opts: BotSimOptions & { options?: Record<string, number>; seed?: number } = {}): BotSimResult {
  const v = DASH_VARIANTS.find((x) => x.id === variant);
  if (!v) throw new Error(`no variant ${variant}`);
  const seed = opts.seed ?? 1;
  const game = createSprintSmash(v, { ...opts.options }, mulberry32(seed));
  const ids = seats.map((_, i) => `p${i}`);
  const tickRate = opts.tickRate ?? 60;
  const bots = seats.map((s, i) => {
    const params = { ...DEFAULT_PARAMS, ...(s.level ? LEVELS[s.level] : {}), ...s.params };
    return new SprintSmashBot({ selfId: ids[i], name: ids[i], tickRate, networkRate: tickRate / (opts.snapEvery ?? 3), seed: seed * 31 + i, params, allies: (s.allies ?? []).map((k) => ids[k]) }, s.policy ?? 'racer');
  });
  return playBots(game, ids, bots, opts);
}
