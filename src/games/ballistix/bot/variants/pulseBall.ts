// Pulse Ball: smash ball plus a central ball-bot (an obstacle, handled by the world model) and a repulsion power-up
// that pushes balls away from the paddle that took it. The bot predicts the push of the opponents' paddles (the world
// model builds it from `physics`). Going for the item was tried and does not pay: it costs about as many balls as the
// item saves, so it is not played (see bot/README.md).
import { pulseBall } from '../../server/variants/pulseBall';
import { speedLimits } from './limits';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { ...speedLimits(pulseBall), repelForce: pulseBall.repel?.force, repelDuration: pulseBall.repel?.duration };

export const create = (): VariantAdapter => ({ boostButton: 'a1' });
