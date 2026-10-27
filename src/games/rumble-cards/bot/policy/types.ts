import type { World } from '../world';

/** what to do next on our turn: play hand[card] at `target` ('' = no target needed), end the turn, or (over the hand limit) discard hand[card] */
export type Plan = { kind: 'play'; card: number; target: string; why: string; value: number } | { kind: 'end'; why: string } | { kind: 'discard'; card: number; why: string };

export interface Policy {
  /** null: nothing to do (not our turn) */
  next(w: World): Plan | null;
}
