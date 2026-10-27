// Why the bot lost hit points: classified from the shots it saw coming and the events around the hit.
import type { Incident } from '../../../core/shared/ai';
import type { GameEvent } from '../../../core/shared/types';

export interface RingEntry {
  time: number;
  x: number;
  y: number;
  mode: string;
  mx: number;
  my: number;
  fire: boolean;
  cost: number;
  /** enemy shots close to us (id -> first seen time) */
  near: number[];
}

/**
 * shot-undodged: a shot it had seen for 0.3 s or more hit it; shot-unseen: one it saw too late; own-mine: a blast where
 * it dropped a mine; blast: a mine or bomb; totem: the totem fell on it.
 */
export function classifyHit(ev: GameEvent, recent: { time: number; ev: GameEvent }[], ring: RingEntry[], myMines: { x: number; y: number; time: number }[], shotSeen: Map<number, number>, time: number): Incident {
  let cause = 'shot-unseen';
  const blast = recent.find((s) => s.ev.kind === 'explode' && time - s.time < 0.05 && Math.hypot(s.ev.x - ev.x, s.ev.y - ev.y) < 420);
  if (recent.some((s) => s.ev.kind === 'smash' && time - s.time < 0.05)) cause = 'totem';
  else if (blast) cause = myMines.some((m) => Math.hypot(m.x - blast.ev.x, m.y - blast.ev.y) < 5) ? 'own-mine' : 'blast';
  else {
    const last = ring[ring.length - 1];
    const ids = last?.near ?? [];
    if (ids.some((id) => time - (shotSeen.get(id) ?? time) >= 0.3)) cause = 'shot-undodged';
  }
  return {
    cause,
    t: time,
    summary: `hit at (${Math.round(ev.x)}, ${Math.round(ev.y)}): ${cause}`,
    detail: { at: { x: ev.x, y: ev.y }, events: recent.map((s) => ({ t: +(time - s.time).toFixed(2), ...s.ev })), ring: ring.slice(-20) },
  };
}
