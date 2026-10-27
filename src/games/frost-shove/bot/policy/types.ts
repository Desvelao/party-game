import type { World } from '../world';

export interface Decision {
  /** stick -1..1 */
  mx: number;
  my: number;
  /** wants to dash now (along `aim`) */
  dash: boolean;
  /** wants the button for the variant's action now (Wild Frenzy: throw the bomb along `aim`) */
  press: boolean;
  /** facing to set with the press, radians (null = keep the stick direction) */
  aim: number | null;
  /** rival it is working on */
  target: string | null;
  /** what it is doing: 'climb' | 'move' | 'rescue' | ... */
  mode: string;
  /** cost of the chosen movement (high = in trouble) */
  cost: number;
  info: Record<string, unknown>;
}

export interface Policy {
  decide(w: World, nowMs: number): Decision;
}

export const idle = (mode = 'idle'): Decision => ({ mx: 0, my: 0, dash: false, press: false, aim: null, target: null, mode, cost: 0, info: {} });
