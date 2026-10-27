// Tip Tumble: the floe tips towards the bears' centre of mass and pushes every bear that way (tiltStrength at full
// tilt). The tilt is in the snapshot; its strength is not, so the default is used in the movement prediction.
import { POLAR_DEFAULTS } from '../../server/config';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { tiltStrength: POLAR_DEFAULTS.tiltStrength };
export const create = (): VariantAdapter => ({});
