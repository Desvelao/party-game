// Jungle Fox: open field, radial mines, the falling totem (a bar from the centre, in the snapshot while it warns) and
// missile pick-ups. The hazards and items are read by the shared policy; nothing to add here.
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { maze: false };
export const create = (): VariantAdapter => ({});
