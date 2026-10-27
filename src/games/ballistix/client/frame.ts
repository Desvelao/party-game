import { FIELD_HALF, rotQuarter } from '../shared/geometry';
import { WORLD_SIZE } from '../../../core/shared/constants';
import { type BallArenaState } from '../shared/types';
import type { RenderHost } from '../../../core/client/src/scenes/host';

export const C = WORLD_SIZE / 2;
export const H = FIELD_HALF;
/** paddle thickness (matches the server) */
export const T = 20;

/**
 * A variant's distortion of the playing field (Cloud Orbs: the platform floats and a corner drops). `at` is the screen
 * offset to add at a screen point; the frame applies it to every field point, so what sits on the deck moves with it.
 */
export interface Warp {
  at(x: number, y: number): [number, number];
  /** how far the deck is raised right now (px, + = up): the shadow on the ground below follows it */
  lift: number;
  /** how far each screen corner (top-left, top-right, bottom-right, bottom-left) has dropped, 0..1 */
  drop: readonly number[];
}

/**
 * Everything a Ballistix drawing function needs for one frame: the graphics
 * object, the interpolation pair, and the viewer-rotated coordinate helpers.
 */
export interface Frame {
  host: RenderHost;
  g: RenderHost['g'];
  /** latest state, plus the two snapshots being interpolated (a -> b by `alpha`) */
  s: BallArenaState;
  a: BallArenaState;
  b: BallArenaState;
  alpha: number;
  now: number;
  /** quarter turns that put the local player's side at the bottom */
  turn: number;
  /** ambient motion allowed, 0..1 (`ClientContext.motion`) */
  motion: number;
  /** the variant's field distortion, null on a flat field */
  warp: Warp | null;
  /** world point -> screen point (field rotated so my side is at the bottom, then warped) */
  W(x: number, y: number): [number, number];
  /** side-canonical point -> screen point */
  S(side: number, cx: number, cy: number): [number, number];
  /** the same without the warp: what is fixed in the air (the engines) and the ground below */
  W0(x: number, y: number): [number, number];
  S0(side: number, cx: number, cy: number): [number, number];
}

export function makeFrame(
  host: RenderHost,
  a: BallArenaState,
  b: BallArenaState,
  s: BallArenaState,
  alpha: number,
  viewerSide: number,
  warp: Warp | null = null,
  motion = 1,
): Frame {
  const turn = (4 - viewerSide) % 4;
  const W0 = (x: number, y: number): [number, number] => {
    const [dx, dy] = rotQuarter(x - C, y - C, turn);
    return [C + dx, C + dy];
  };
  const S0 = (side: number, cx: number, cy: number): [number, number] => {
    const [dx, dy] = rotQuarter(cx, cy, (side + turn) % 4);
    return [C + dx, C + dy];
  };
  const lift = (p: [number, number]): [number, number] => {
    if (!warp) return p;
    const [ox, oy] = warp.at(p[0], p[1]);
    return [p[0] + ox, p[1] + oy];
  };
  return {
    host,
    g: host.g,
    s,
    a,
    b,
    alpha,
    now: performance.now(),
    turn,
    motion,
    warp,
    W: (x, y) => lift(W0(x, y)),
    S: (side, cx, cy) => lift(S0(side, cx, cy)),
    W0,
    S0,
  };
}
