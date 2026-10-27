/** Frost Shove: one simulation, five variants selected by flags in `config.ts`. */
import type { OptionValue } from '../../../core/shared/catalog';
import { FrostShove } from './FrostShove';
import { POLAR_VARIANTS, applyOptions, type PolarVariant } from './config';

export { FrostShove } from './FrostShove';
export { POLAR_VARIANTS, applyOptions, type PolarConfig, type PolarVariant } from './config';

export function createFrostShove(v: PolarVariant, options: Record<string, OptionValue>, rng?: () => number): FrostShove {
  return new FrostShove(applyOptions(v, options), rng);
}
