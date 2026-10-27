// Server half of Frost Shove: one simulation, five variants.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import { POLAR_VARIANTS, createFrostShove } from './create';
import { frostShove } from '../bot';

const plugin: ServerGamePlugin = {
  createMinigame(playableId, options, rng) {
    const v = POLAR_VARIANTS.find((x) => x.id === playableId);
    if (!v) throw new Error(`frost-shove has no variant "${playableId}"`);
    return createFrostShove(v, options, rng);
  },
  ai: frostShove,
};
export default plugin;
