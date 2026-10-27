import type { CoreConfig } from '../core/config';
import type { EnemyConfig } from './pulseBall';
import type { EnginesConfig } from './cloudOrbs';
import type { MagnetConfig } from './sandOrb';
import type { RepelConfig } from './repel';

/**
 * A variant = the core config + the (optional) sections of the modules it
 * uses. The core only ever sees the `CoreConfig` part.
 */
export type VariantConfig = CoreConfig & {
  magnet?: MagnetConfig;
  enemy?: EnemyConfig;
  repel?: RepelConfig;
  engines?: EnginesConfig;
};
