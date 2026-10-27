// Server half of Ballistix: a core rule set plus variants built from modules.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import type { BallArenaState } from '../shared/types';
import { VARIANTS, applyOptions, createBallArena } from './arena';
import { ballistix } from '../bot';
import { greedyBalls } from './bot';

const plugin: ServerGamePlugin = {
  createMinigame(playableId, options, rng) {
    const v = VARIANTS.find((x) => x.id === playableId);
    if (!v) throw new Error(`ballistix has no variant "${playableId}"`);
    // the arena takes a seed, so tests and the balance tool stay reproducible through the injected rng
    return createBallArena(applyOptions(v, options), rng ? (rng() * 2 ** 32) >>> 0 : undefined);
  },
  bot: (state, id) => greedyBalls(state as BallArenaState, id),
  ai: ballistix,
};
export default plugin;
