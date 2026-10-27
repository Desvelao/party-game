// Thaw Frenzy: bites melt out of the rim now and then (the snapshot warns 1.5 s before; the world lowers the predicted edge
// there at once, world.ts) and Gruff's beam only gives bad power-ups, so the policy keeps out of it.
import { POLAR_DEFAULTS } from '../../server/config';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { meltDepth: POLAR_DEFAULTS.meltDepth, badBeam: true };
export const create = (): VariantAdapter => ({});
