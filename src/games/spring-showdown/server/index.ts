// Server half of Spring Showdown: one simulation, four variants.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import type { PogoState } from '../shared/types';
import { greedyPogo } from './bot';
import { POGO_VARIANTS, createSpringShowdown } from './create';
import { springShowdown } from '../bot';

const plugin: ServerGamePlugin = {
  createMinigame(playableId, options, rng) {
    const v = POGO_VARIANTS.find((x) => x.id === playableId);
    if (!v) throw new Error(`spring-showdown has no variant "${playableId}"`);
    return createSpringShowdown(v, options, rng);
  },
  bot: (state, id, rng) => greedyPogo(state as PogoState, id, rng),
  ai: springShowdown,
};
export default plugin;
