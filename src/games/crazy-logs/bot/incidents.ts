// Why the bot fell in the river: classified from its last decisions and the events of the last second.
import type { Incident } from '../../../core/shared/ai';
import type { GameEvent } from '../../../core/shared/types';
import { JET_RADIUS, LOGS_LEFT, LOGS_RIGHT, PLAYER_R } from './physics';

export interface RingEntry {
  time: number;
  x: number;
  y: number;
  /** in the air */
  air: boolean;
  mode: string;
  /** spin of the row it stands on */
  v: number;
  mx: number;
  my: number;
  ty: number | null;
  /** another player was within shoving distance */
  crowded: boolean;
}

/**
 * missed-landing: a hop came down in the water; x-edge: walked or was pushed off a log end; jet: a jet erupted next to
 * it; shoved: another player was against it; spun-off: the log's spin carried it over the edge.
 */
export function classifySplash(ring: RingEntry[], recent: { time: number; ev: GameEvent }[], at: GameEvent, time: number): Incident {
  const last = ring[ring.length - 1];
  let cause = 'spun-off';
  const justLanded = ring.some((r) => r.air && time - r.time <= 0.15);
  if (justLanded) cause = 'missed-landing';
  else if (at.x < LOGS_LEFT + PLAYER_R || at.x > LOGS_RIGHT - PLAYER_R) cause = 'x-edge';
  else if (ring.some((r) => r.crowded && time - r.time <= 0.4)) cause = 'shoved';
  if (recent.some((s) => s.ev.kind === 'jet' && time - s.time <= 0.8 && Math.hypot(s.ev.x - at.x, s.ev.y - at.y) < JET_RADIUS + 60)) cause = 'jet';
  return {
    cause,
    t: time,
    summary: `fell in at (${Math.round(at.x)}, ${Math.round(at.y)}) while ${last?.mode ?? '?'}: ${cause}`,
    detail: { at: { x: at.x, y: at.y }, ring: ring.slice(-30) },
  };
}
