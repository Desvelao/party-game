// Server half of Tank Wars: one simulation, four variants.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import { TANK_VARIANTS, createTankWars } from './create';
import { tankWars } from '../bot';

const plugin: ServerGamePlugin = {
  createMinigame(playableId, options, rng) {
    const v = TANK_VARIANTS.find((x) => x.id === playableId);
    if (!v) throw new Error(`tank-wars has no variant "${playableId}"`);
    return createTankWars(v, options, rng);
  },
  ai: tankWars,
};
export default plugin;
