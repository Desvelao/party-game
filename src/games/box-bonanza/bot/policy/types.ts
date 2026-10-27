import type { World } from '../world';

export interface Decision {
  /** stick -1..1 (the way it walks and faces) */
  mx: number;
  my: number;
  /** press a1 now: weapon, else throw the held crate, else pick one up; facing `aim` */
  act: boolean;
  /** press a2 now: the kick */
  kick: boolean;
  /** facing for the press, radians (null = the stick direction) */
  aim: number | null;
  mode: string;
  target: string | null;
  goal: { x: number; y: number } | null;
  cost: number;
  info: Record<string, unknown>;
}

export interface Policy {
  decide(w: World, nowMs: number): Decision;
}

export const idle = (mode = 'idle'): Decision => ({ mx: 0, my: 0, act: false, kick: false, aim: null, mode, target: null, goal: null, cost: 0, info: {} });
