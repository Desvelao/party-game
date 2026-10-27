// Server half of Sprint Smash: one simulation, four variants.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import { DASH_VARIANTS, createSprintSmash } from './create';
import { sprintSmash } from '../bot';

const plugin: ServerGamePlugin = {
  createMinigame(playableId, options, rng) {
    const v = DASH_VARIANTS.find((x) => x.id === playableId);
    if (!v) throw new Error(`sprint-smash has no variant "${playableId}"`);
    return createSprintSmash(v, options, rng);
  },
  ai: sprintSmash,
};
export default plugin;
