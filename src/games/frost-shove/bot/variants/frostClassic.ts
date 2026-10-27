// Frost Shove: the baseline, plus the wall of ice slices on the rim (read from the snapshot).
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { wall: true };
export const create = (): VariantAdapter => ({});
