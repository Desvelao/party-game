// What slowed the bot down: every knock (hit / boom event) classified by what was next to it.
import type { Incident } from '../../../core/shared/ai';
import type { GameEvent } from '../../../core/shared/types';

export interface RingEntry {
  time: number;
  x: number;
  y: number;
  a: number;
  r: number;
  line: number;
  mode: string;
  /** what was close: missile / lava / blob / rod / barrel */
  near: string[];
}

/** missile, lava, blob, rod, barrel (a boom on us), star (a rival's shock), bump (another craft), unknown */
export function classify(selfId: string, ev: GameEvent, recent: { time: number; ev: GameEvent }[], ring: RingEntry[], time: number): Incident | null {
  if (ev.id !== selfId || (ev.kind !== 'hit' && ev.kind !== 'boom' && ev.kind !== 'bump')) return null;
  let cause = 'unknown';
  const near = ring[ring.length - 1]?.near ?? [];
  if (ev.kind === 'boom') cause = 'barrel';
  else if (ev.kind === 'bump') cause = 'bump';
  else if (recent.some((s) => s.ev.kind === 'zap' && s.ev.id !== selfId && time - s.time < 0.05)) cause = 'star';
  else if (near.length) cause = near[0];
  return {
    cause,
    t: time,
    summary: `knocked at (${Math.round(ev.x)}, ${Math.round(ev.y)}): ${cause}`,
    detail: { at: { x: ev.x, y: ev.y }, ring: ring.slice(-20) },
  };
}
