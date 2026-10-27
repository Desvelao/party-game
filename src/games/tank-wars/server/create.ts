/** Tank Wars: one simulation, four variants selected by flags in `config.ts`. */
import type { OptionValue } from '../../../core/shared/catalog';
import { TankWars } from './TankWars';
import { TANK_VARIANTS, applyOptions, type TankVariant } from './config';

export { TankWars } from './TankWars';
export { TANK_VARIANTS, applyOptions, type TankConfig, type TankVariant } from './config';

export function createTankWars(v: TankVariant, options: Record<string, OptionValue>, rng?: () => number): TankWars {
  return new TankWars(applyOptions(v, options), rng);
}
