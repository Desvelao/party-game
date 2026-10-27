import type { LogsPlayerState } from '../../shared/types';
import type { Ground } from '../physics';
import type { World } from '../world';

/** What the bot always knows about itself (from the newest snapshot, whatever its reaction time). */
export interface Self {
  me: LogsPlayerState;
  ground: Ground;
  /** ms it has been ready to hop (0 = not ready) */
  readyMs: number;
}

export interface Decision {
  /** stick: the walking direction, or the hop direction when `hop` */
  mx: number;
  my: number;
  hop: boolean;
  /** 'hop' | 'back' | 'walk' | 'wait' | 'escape' | 'idle' */
  mode: string;
  /** landing it aims at (when it has one) */
  tx: number | null;
  ty: number | null;
  info: Record<string, unknown>;
}

export interface Policy {
  decide(env: World, self: Self, nowMs: number): Decision;
}

export const idle = (mode = 'idle'): Decision => ({ mx: 0, my: 0, hop: false, mode, tx: null, ty: null, info: {} });
