/**
 * Crazy Logs layout (world units, WORLD_SIZE = 1000). Shared so the server
 * simulation and the client renderer agree on where the river, logs and banks are.
 * y grows downwards: players start on the bottom bank and hop up to the top one.
 */
/** the start bank is y >= LOGS_START_Y */
export const LOGS_START_Y = 840;
/** reaching y <= LOGS_FINISH_Y (the far bank) finishes the round for a player */
export const LOGS_FINISH_Y = 190;
export const LOGS_ROWS = 6;
/** distance between the centres of two neighbouring logs */
export const LOGS_PITCH = 100;
/** half the thickness of a log */
export const LOGS_HALF_H = 32;
/** y of the centre of the first (closest to the start bank) log */
export const LOGS_FIRST_Y = 760;
/** horizontal extent of every log; past it is open water */
export const LOGS_LEFT = 90;
export const LOGS_RIGHT = 910;

/** y centre of log row `i` (0 = closest to the start bank) */
export const logRowY = (i: number): number => LOGS_FIRST_Y - i * LOGS_PITCH;

/** First / last log centre: the logs are spread evenly between them whatever their number. */
export const LOGS_LAST_Y = LOGS_FIRST_Y - (LOGS_ROWS - 1) * LOGS_PITCH;

export interface LogsLayout {
  count: number;
  /** distance between the centres of two neighbouring logs */
  pitch: number;
  /** half the thickness of a log */
  half: number;
  /** y of each log centre, 0 = nearest the start bank */
  centres: number[];
}

/** Layout for `count` logs of thickness `size`; neighbouring logs never overlap (4 units of water at least). */
export function logsLayout(count: number, size: number): LogsLayout {
  const n = Math.max(2, Math.round(count));
  const pitch = (LOGS_FIRST_Y - LOGS_LAST_Y) / (n - 1);
  const half = Math.max(8, Math.min(size / 2, pitch / 2 - 4));
  return { count: n, pitch, half, centres: Array.from({ length: n }, (_, i) => LOGS_FIRST_Y - i * pitch) };
}
