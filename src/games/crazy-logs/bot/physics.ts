// What the bot knows of the river: the server's own constants (imported, so the two cannot drift), the ground under
// a point, and the option-dependent numbers it cannot see (hop length, landing impulse), which it learns by watching.
import { LOGS_FINISH_Y, LOGS_LEFT, LOGS_RIGHT, LOGS_START_Y } from '../shared/geometry';
import { DEFAULT_CONFIG } from '../server/config';

export { HOP_COOLDOWN, HOP_TIME, JET_RADIUS, JET_WARN, LAND_ASSIST, PLAYER_R, START_Y, WALK_SPEED } from '../server/CrazyLogs';
export { LOGS_FINISH_Y, LOGS_LEFT, LOGS_RIGHT, LOGS_START_Y };

/** defaults until watched: the host may change both (hopDistance, stability) */
export const DEFAULT_HOP = DEFAULT_CONFIG.hopDistance;
export const DEFAULT_LAND_IMPULSE = DEFAULT_CONFIG.landImpulse;

export type Ground = { kind: 'start' } | { kind: 'finish' } | { kind: 'log'; row: number } | { kind: 'water' };

/** the server's ground test (groundAt in CrazyLogs.ts); `slack` widens logs (landing assist) */
export function groundAt(x: number, y: number, rows: readonly { y: number }[], half: number, slack = 0): Ground {
  if (y <= LOGS_FINISH_Y) return { kind: 'finish' };
  if (y >= LOGS_START_Y) return { kind: 'start' };
  if (x >= LOGS_LEFT - slack && x <= LOGS_RIGHT + slack) {
    for (let i = 0; i < rows.length; i++) if (Math.abs(y - rows[i].y) <= half + slack) return { kind: 'log', row: i };
  }
  return { kind: 'water' };
}
