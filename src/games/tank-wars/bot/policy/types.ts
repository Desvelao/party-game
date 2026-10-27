import type { World } from '../world';

export interface Decision {
  /** stick -1..1 */
  mx: number;
  my: number;
  /** hold a1: the cannon (it fires along the way we drive) */
  fire: boolean;
  /** press a1 once: use the held item (bomb or missiles) instead of the cannon */
  item: boolean;
  /** press a2 once: drop a mine */
  mine: boolean;
  /** hold a2 (Swamp Fox: the shield) */
  holdA2: boolean;
  /** 'attack' | 'move' | 'pickup' | 'idle' */
  mode: string;
  target: string | null;
  goal: { x: number; y: number } | null;
  /** cost of the chosen move (high = in danger) */
  cost: number;
  info: Record<string, unknown>;
}

export interface Policy {
  decide(w: World, nowMs: number): Decision;
  /** heavy setup for a new snapshot (the path grid), done when it arrives rather than inside decide() */
  prepare?(w: World): void;
}

export const idle = (mode = 'idle'): Decision => ({ mx: 0, my: 0, fire: false, item: false, mine: false, holdA2: false, mode, target: null, goal: null, cost: 0, info: {} });
