// Ties the sound, the flying effect and the impact of a card together: they all start from the same cast event.
import { calm, type EffectKind } from './anim';

export interface Cast {
  c: number;
  /** who played it, and against whom ('' for none) */
  p: string;
  tg: string;
  kind: EffectKind;
  color: number;
  /** the card deals direct damage (a comet flies to the target whatever else it does) */
  hits?: boolean;
}

const queue: Cast[] = [];
let last: { kind: EffectKind; at: number; hits: boolean } | null = null;

/** A card was cast: queue it for the board and remember when, so its impacts can be delayed to match the flight. */
export function noteCast(cast: Cast): void {
  queue.push(cast);
  if (queue.length > 8) queue.shift();
  last = { kind: cast.kind, at: performance.now(), hits: !!cast.hits };
}

/** the casts the board has not drawn yet */
export function takeCasts(): Cast[] {
  return queue.splice(0);
}

export function resetTiming(): void {
  queue.length = 0;
  last = null;
}

/** how long (ms) the flight of the card just cast takes to arrive, for the hits that came with it */
const TRAVEL: Partial<Record<EffectKind, number>> = { shot: 610, wave: 610 };
/** a card with direct damage is hit by its comet whatever its main effect */
const COMET = 610;

/** Milliseconds to wait before showing and sounding an impact: 0 unless a card was cast a moment ago. */
export function impactDelay(): number {
  if (calm() || !last || performance.now() - last.at > 250) return 0;
  return last.hits ? COMET : TRAVEL[last.kind] ?? 0;
}
