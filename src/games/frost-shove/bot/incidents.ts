// Why the bot fell in: classified from the events of the last second and its own decisions.
import type { Incident } from '../../../core/shared/ai';
import type { GameEvent } from '../../../core/shared/types';

export interface RingEntry {
  time: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mode: string;
  mx: number;
  my: number;
  dash: boolean;
  cost: number;
  target: string | null;
}

export interface Seen {
  time: number;
  ev: GameEvent;
}

const WINDOW = 1;

/**
 * pushed: a rival dashed and we were close; bumped: a plain collision; dash-overshoot: our own dash took us out;
 * bolt / bomb: the variant's hazard hit us; edge-drift: nothing touched us (walked off, or the ice went under us).
 */
export function classifyFall(selfId: string, ring: RingEntry[], seen: Seen[], at: GameEvent, time: number): Incident {
  const recent = seen.filter((s) => time - s.time <= WINDOW);
  const near = (e: GameEvent, d: number) => Math.hypot(e.x - at.x, e.y - at.y) <= d;
  let cause = 'edge-drift';
  if (ring.some((r) => r.dash && time - r.time <= 0.7)) cause = 'dash-overshoot';
  if (recent.some((s) => s.ev.kind === 'bump' && near(s.ev, 220))) cause = 'bumped';
  if (recent.some((s) => s.ev.kind === 'dash' && s.ev.id !== selfId && near(s.ev, 320))) cause = 'pushed';
  if (recent.some((s) => s.ev.kind === 'hit' && s.ev.id === selfId)) cause = 'bolt';
  if (recent.some((s) => s.ev.kind === 'boom' && s.ev.id !== selfId && near(s.ev, 300))) cause = 'bomb';
  const last = ring[ring.length - 1];
  return {
    cause,
    t: time,
    summary: `fell in at (${Math.round(at.x)}, ${Math.round(at.y)}) while ${last?.mode ?? '?'}: ${cause}`,
    detail: { at: { x: at.x, y: at.y }, events: recent.map((s) => ({ t: +(time - s.time).toFixed(2), ...s.ev })), ring: ring.slice(-30) },
  };
}
