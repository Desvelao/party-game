// State of Crazy Logs as sent to clients (server builds it, the renderer reads it).
// Plain `type`s so they are assignable to the core's open ExternalState.

export type LogsPlayerState = {
  id: string;
  x: number;
  y: number;
  /** facing angle, radians */
  f: number;
  /** still in the match (false after a disconnect) */
  alive: boolean;
  /** hop progress 0..1, 0 = on the ground */
  h: number;
  /** hop readiness 0..1 (1 = ready) */
  d: number;
  /** crossings completed (the points) */
  score: number;
  falls: number;
  /** sinking in the river, restarting soon: 1 -> 0, 0 = in play */
  w: number;
};

/** Timed rounds, a point per crossing. Geometry is in geometry.ts. */
export type LogsState = {
  kind: 'ext:crazy-logs';
  t: number;
  /** round length, s */
  limit: number;
  /** per log row (0 = nearest the start bank): signed surface speed along y (+ = towards the start bank, - = towards the far bank) and stripe phase */
  rows: { v: number; ph: number; y: number }[];
  /** half the thickness of every log */
  half: number;
  /** water jets: telegraph left 1 -> 0 (w), then erupting (e) for a moment */
  jets: { x: number; y: number; w: number; e: boolean }[];
  players: LogsPlayerState[];
};
