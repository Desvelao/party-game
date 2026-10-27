// Server half of Box Bonanza: one simulation, four variants.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import { CRATE_VARIANTS, createBoxBonanza } from './create';
import { boxBonanza } from '../bot';

const plugin: ServerGamePlugin = {
  createMinigame(playableId, options, rng) {
    const v = CRATE_VARIANTS.find((x) => x.id === playableId);
    if (!v) throw new Error(`box-bonanza has no variant "${playableId}"`);
    return createBoxBonanza(v, options, rng);
  },
  ai: boxBonanza,
};
export default plugin;
