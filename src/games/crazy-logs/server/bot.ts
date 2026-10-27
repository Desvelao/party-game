// Greedy bot for `npm run balance`: cross the river by hopping when the landing spot is on a log.
import type { GameState, InputState } from '../../../core/shared/types';
import { LOGS_FINISH_Y } from '../shared/geometry';
import type { LogsState } from '../shared/types';

const IDLE: InputState = { mx: 0, my: 0, a1: false, a2: false };

/** Hop when the landing spot is on a log (hops are 100 apart), else shuffle on the log until it is. */
export function greedyLogs(state: GameState, id: string): InputState {
  const s = state as LogsState;
  const me = s.players.find((p) => p.id === id);
  if (!me || me.w > 0 || me.h > 0) return IDLE;
  const land = me.y - 100;
  if (land <= LOGS_FINISH_Y + 20) return { mx: 0, my: -1, a1: true, a2: false };
  let c = s.rows[0].y;
  for (const r of s.rows) if (Math.abs(r.y - land) < Math.abs(c - land)) c = r.y;
  const mx = me.x < 200 ? 1 : me.x > 800 ? -1 : 0;
  if (Math.abs(land - c) <= s.half * 0.6 && me.d >= 1) return { mx, my: -1, a1: true, a2: false };
  return { mx, my: Math.sign(c + 100 - me.y), a1: false, a2: false };
}
