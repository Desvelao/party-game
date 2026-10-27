// Why the bot got hurt or knocked out: classified from the events of that moment and what it saw coming.
import type { Incident } from '../../../core/shared/ai';
import type { GameEvent } from '../../../core/shared/types';

export interface RingEntry {
  time: number;
  x: number;
  y: number;
  hp: number;
  mode: string;
  mx: number;
  my: number;
  cost: number;
  /** flying crates near us that we did not send */
  flying: number;
}

/**
 * blast: a TNT or nitro went off by it; kicked: a rival's kick; crate-hit: a flying crate; weapon: a ring, missile or
 * orb (a rival fired one lately); penguin; hole (Space Bonanza, knocked out with no hit); weight (the countdown ran out
 * on it); unknown (nothing seen: worth reading the incident).
 */
export function classify(selfId: string, ev: GameEvent, recent: { time: number; ev: GameEvent }[], ring: RingEntry[], time: number): Incident | null {
  const now = recent.filter((s) => time - s.time < 0.05);
  let cause = '';
  if (ev.kind === 'hit' || ev.kind === 'crack') {
    if (now.some((s) => s.ev.kind === 'explode' && s.ev.id === '' && Math.hypot(s.ev.x - ev.x, s.ev.y - ev.y) < 260)) cause = 'blast';
    else if (now.some((s) => s.ev.kind === 'explode' && s.ev.id && s.ev.id !== selfId)) cause = 'weapon';
    else if (now.some((s) => s.ev.kind === 'kick' && s.ev.id && s.ev.id !== selfId)) cause = 'kicked';
    else if (now.some((s) => s.ev.kind === 'bump' && s.ev.id === selfId)) cause = 'penguin';
    else if (now.some((s) => (s.ev.kind === 'rocket' || s.ev.kind === 'zap') && s.ev.id !== selfId) || recent.some((s) => (s.ev.kind === 'rocket' || s.ev.kind === 'zap') && s.ev.id !== selfId && time - s.time < 3.5)) cause = 'weapon';
    else if ((ring.length && ring[ring.length - 1].flying > 0) || recent.some((s) => (s.ev.kind === 'throw' || s.ev.kind === 'kick') && s.ev.id !== selfId && time - s.time < 1.5)) cause = 'crate-hit';
    else cause = 'unknown';
    if (ev.kind === 'crack') cause += '-masked';
  } else if (ev.kind === 'eliminated' && ev.id === selfId) {
    const hit = recent.some((s) => s.ev.kind === 'hit' && s.ev.id === selfId && time - s.time < 0.05);
    if (now.some((s) => s.ev.kind === 'explode' && s.ev.id === selfId)) cause = 'weight';
    else if (!hit) cause = 'hole';
  }
  if (!cause) return null;
  const last = ring[ring.length - 1];
  return {
    cause,
    t: time,
    summary: `${ev.kind === 'eliminated' ? 'out' : 'hurt'} at (${Math.round(ev.x)}, ${Math.round(ev.y)}) while ${last?.mode ?? '?'}: ${cause}`,
    detail: { at: { x: ev.x, y: ev.y }, events: recent.map((s) => ({ t: +(time - s.time).toFixed(2), ...s.ev })), ring: ring.slice(-20) },
  };
}
