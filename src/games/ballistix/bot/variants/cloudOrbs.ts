// Cloud Orbs: failing engines pull the balls to a corner. It shows in the snapshot;
// the numbers behind it (pull, durations) are the server's own (server/variants/cloudOrbs.ts).
import { ENGINE_WARN, cloudOrbs } from '../../server/variants/cloudOrbs';
import { speedLimits } from './limits';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = {
  ...speedLimits(cloudOrbs),
  pullAccel: cloudOrbs.engines?.pull,
  engineWarn: ENGINE_WARN,
  engineFail: cloudOrbs.engines?.duration,
};

export const create = (): VariantAdapter => ({ boostButton: 'a1' });
