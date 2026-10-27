/** Spring Showdown: one simulation, four variants selected by flags in `config.ts`. */
import type { OptionValue } from '../../../core/shared/catalog';
import { SpringShowdown } from './SpringShowdown';
import { POGO_VARIANTS, applyOptions, type PogoVariant } from './config';

export { SpringShowdown } from './SpringShowdown';
export { POGO_VARIANTS, applyOptions, type PogoConfig, type PogoVariant } from './config';

export function createSpringShowdown(v: PogoVariant, options: Record<string, OptionValue>, rng?: () => number): SpringShowdown {
  return new SpringShowdown(applyOptions(v, options), rng);
}
