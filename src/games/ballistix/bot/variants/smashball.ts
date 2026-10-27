// Smash ball is the baseline the shared AI is written for: only the server's speed limits to add.
import { smashball } from '../../server/variants/smashball';
import { speedLimits } from './limits';
import type { Physics, VariantAdapter } from './types';

export const physics: Physics = { ...speedLimits(smashball) };

export const create = (): VariantAdapter => ({ boostButton: 'a1' });
