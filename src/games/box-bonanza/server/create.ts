/** Box Bonanza: one simulation, four variants selected by flags in `config.ts`. */
import type { OptionValue } from '../../../core/shared/catalog';
import { BoxBonanza } from './BoxBonanza';
import { CRATE_VARIANTS, applyOptions, type CrateVariant } from './config';

export { BoxBonanza } from './BoxBonanza';
export { CRATE_VARIANTS, applyOptions, type CrateConfig, type CrateVariant } from './config';

export function createBoxBonanza(v: CrateVariant, options: Record<string, OptionValue>, rng?: () => number): BoxBonanza {
  return new BoxBonanza(applyOptions(v, options), rng);
}
