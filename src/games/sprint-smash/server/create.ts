/** Sprint Smash: one simulation, four variants selected by flags in `config.ts`. */
import type { OptionValue } from '../../../core/shared/catalog';
import { SprintSmash } from './SprintSmash';
import { DASH_VARIANTS, applyOptions, type DashVariant } from './config';

export { SprintSmash } from './SprintSmash';
export { DASH_VARIANTS, applyOptions, type DashConfig, type DashVariant } from './config';

export function createSprintSmash(v: DashVariant, options: Record<string, OptionValue>, rng?: () => number): SprintSmash {
  return new SprintSmash(applyOptions(v, options), rng);
}
