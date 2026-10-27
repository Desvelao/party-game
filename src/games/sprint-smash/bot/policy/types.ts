import type { World } from '../world';

export interface Decision {
  /** stick: the heading to turn towards */
  mx: number;
  my: number;
  /** hold the throttle */
  throttle: boolean;
  /** press the button now: use the held item (or jump in Splash Sprint) */
  press: boolean;
  /** radius of the line it drives */
  line: number;
  mode: string;
  cost: number;
  info: Record<string, unknown>;
}

export interface Policy {
  decide(w: World, nowMs: number): Decision;
}

export const idle = (mode = 'idle'): Decision => ({ mx: 0, my: 0, throttle: false, press: false, line: 0, mode, cost: 0, info: {} });
