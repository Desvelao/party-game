// The speed limits the server clamps free balls to, from a variant's own config (so the two cannot drift).
import { BALL_CEIL, smashCeilOf, type CoreConfig } from '../../server/core/config';
import type { Physics } from './types';

export const speedLimits = (cfg: Pick<CoreConfig, 'ballMaxSpeed' | 'ballMinSpeed' | 'smashGain'>): Pick<Physics, 'vmin' | 'vmax' | 'vmaxSmash'> => ({
  vmin: cfg.ballMinSpeed,
  vmax: cfg.ballMaxSpeed * BALL_CEIL,
  vmaxSmash: cfg.ballMaxSpeed * smashCeilOf(cfg.smashGain),
});
