// Frost Frenzy: energy bolts. A bolt line warns for BOLT_WARN s and then flings every bear on it sideways (620 px/s,
// stunned), which near the edge is a fall. The shared policy scores the bands as hazards (world.bolts); nothing else.
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { bolts: true };
export const create = (): VariantAdapter => ({});
