import { CORE_DEFAULTS } from '../core/config';
import type { VariantConfig } from './config';

/** The baseline: the core rules and nothing else. */
export const smashball: VariantConfig = {
  ...CORE_DEFAULTS,
  id: 'smashball',
  name: 'Smashball',
};
