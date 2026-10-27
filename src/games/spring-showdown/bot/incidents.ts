// What went wrong for the bot: a stun (and why), or its own colour wiped. Classified from the events around it.
import type { Incident } from '../../../core/shared/ai';
import type { GameEvent } from '../../../core/shared/types';

export interface RingEntry {
  time: number;
  c: number;
  r: number;
  dir: number;
  mode: string;
  value: number;
  tiles: number;
}

/**
 * missile: a rival's missile (a rocket event came first); bomber-missile: Blast Bot's (no rocket); beam: a rival's zap;
 * tnt / mushroom: landed on one; blast: caught in a TNT explosion; self-wipe: landed on its own colour in Spring Lock (it should never).
 */
export function classify(selfId: string, ev: GameEvent, recent: { time: number; ev: GameEvent }[], ring: RingEntry[], time: number, mushrooms: boolean): Incident | null {
  let cause = '';
  if (ev.kind === 'wipe' && ev.id === selfId) cause = 'self-wipe';
  else if (ev.kind === 'stun' && ev.id === selfId) {
    const before = recent.filter((s) => time - s.time <= 1.5 && s.ev.id !== selfId);
    if (recent.some((s) => s.ev.kind === 'tnt' && s.ev.id === selfId && time - s.time < 0.05)) cause = 'tnt';
    else if (recent.some((s) => s.ev.kind === 'boom' && time - s.time < 0.05)) cause = 'blast';
    else if (before.some((s) => s.ev.kind === 'zap' && time - s.time < 0.05)) cause = 'beam';
    else if (before.some((s) => s.ev.kind === 'rocket')) cause = 'missile';
    // no rocket, zap or TNT: a mushroom where there are mushrooms, else a missile nobody fired (Blast Bot's)
    else cause = mushrooms ? 'mushroom' : 'bomber-missile';
  }
  if (!cause) return null;
  const last = ring[ring.length - 1];
  return {
    cause,
    t: time,
    summary: `${cause} at tile ${last ? `${last.c},${last.r}` : '?'} holding ${last?.tiles ?? 0} squares`,
    detail: { at: { x: ev.x, y: ev.y }, events: recent.map((s) => ({ t: +(time - s.time).toFixed(2), ...s.ev })), ring: ring.slice(-20) },
  };
}
