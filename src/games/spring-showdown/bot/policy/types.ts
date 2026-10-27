import type { World } from '../world';

export interface Decision {
  /** direction to hold: 0 up, 1 right, 2 down, 3 left; -1 = let go */
  dir: number;
  /** use the held item now, facing `fireDir` */
  fire: boolean;
  fireDir: number;
  mode: string;
  /** value of the chosen plan */
  value: number;
  info: Record<string, unknown>;
}

export interface Policy {
  decide(w: World, nowMs: number): Decision;
}

export const idle = (mode = 'idle'): Decision => ({ dir: -1, fire: false, fireDir: 0, mode, value: 0, info: {} });
