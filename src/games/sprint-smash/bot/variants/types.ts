// What differs between Sprint Smash variants, from the bot's point of view. Perception, prediction and the racer are
// shared (Dot Sprint is the baseline); a variant's rules are the server's own flags (server/config.ts), plus an optional
// `refine` for its own action (Splash Sprint's jump).
import type { DashConfig } from '../../server/config';
import type { Decision } from '../policy/types';
import type { World } from '../world';

export type Rules = Pick<DashConfig, 'missiles' | 'toxic' | 'volcano' | 'rods' | 'rodSpeed' | 'edgeWalls' | 'outerArc' | 'berryBar' | 'straightMissiles' | 'item2'>;

export interface VariantAdapter {
  readonly rules: Rules;
  refine?(w: World, d: Decision, P: Record<string, number>, nowMs: number, rng: () => number): void;
}
