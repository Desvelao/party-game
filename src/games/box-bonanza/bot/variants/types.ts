// What differs between Box Bonanza variants, from the bot's point of view. Perception, prediction and the brawler
// policy are shared (Jungle Bonanza is the baseline); a variant's rules are the server's own flags (server/config.ts).
import type { CrateConfig } from '../../server/config';

export type Rules = Pick<CrateConfig, 'floorHoles' | 'slippery' | 'penguin' | 'powerups' | 'nitro' | 'lockedCrates' | 'qboxes'>;

export interface VariantAdapter {
  readonly rules: Rules;
}
