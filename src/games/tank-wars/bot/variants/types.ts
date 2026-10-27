// What differs between Tank Wars variants, from the bot's point of view. Perception, prediction and the tactician
// policy are shared (Desert Fox is the baseline); a variant only says what the snapshot does not (is there a maze,
// how do its mines go off) and may add a `refine` step for its own action (Swamp Fox's shield).
import type { Decision } from '../policy/types';
import type { World } from '../world';

export interface Physics {
  /** the block maze is on (the snapshot only says `rails`; Desert and Metal Fox keep the maze without rails too) */
  maze: boolean;
  /** Swamp Fox: boats, contact mines, the shield on a2 held */
  swamp?: boolean;
}

export interface VariantAdapter {
  refine?(w: World, d: Decision, P: Record<string, number>, nowMs: number, rng: () => number): void;
}
