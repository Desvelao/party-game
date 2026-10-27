// Metal Fox: Desert Fox plus metal walls that switch every `wallEvery` s (raised and warning are in the snapshot,
// world.ts treats a warning as both groups raised) and bomb pick-ups (the policy lobs them). Nothing to add here.
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { maze: true };
export const create = (): VariantAdapter => ({});
