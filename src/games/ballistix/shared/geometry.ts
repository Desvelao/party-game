import { WORLD_SIZE } from '../../../core/shared/constants';

/**
 * Radius of the quarter disc in each corner of the Ballistix field; it also is how far the
 * corner reaches along both edges, where the goals end.
 */
export const CORNER_SIZE = 80;

/** World-space point of field corner `i` (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left): the quarter disc's centre. */
export function fieldCorner(i: number): [number, number] {
  const c = WORLD_SIZE / 2;
  const sx = i === 1 || i === 2 ? 1 : -1;
  const sy = i >= 2 ? 1 : -1;
  return [c + sx * FIELD_HALF, c + sy * FIELD_HALF];
}

/**
 * World-space launcher point of corner `i`, inside its quarter disc, `CORNER_SIZE / 2` from both
 * edges (balls wait here; variant features such as engines sit here). The corner is a wall and
 * not part of any goal.
 */
export function cornerCenter(i: number): [number, number] {
  const c = WORLD_SIZE / 2;
  const o = FIELD_HALF - CORNER_SIZE / 2;
  const sx = i === 1 || i === 2 ? 1 : -1;
  const sy = i >= 2 ? 1 : -1;
  return [c + sx * o, c + sy * o];
}

/** Half the side length of the square Ballistix field (centred on the world). */
export const FIELD_HALF = 400;

/**
 * Rotate an offset (dx,dy) by k quarter turns, in screen space (y down):
 * k=1 maps the bottom edge onto the left edge. Exact, no trig.
 * Shared so the server's side frames and the client's camera agree.
 */
export function rotQuarter(dx: number, dy: number, k: number): [number, number] {
  switch (((k % 4) + 4) % 4) {
    case 1:
      return [-dy, dx];
    case 2:
      return [-dx, -dy];
    case 3:
      return [dy, -dx];
    default:
      return [dx, dy];
  }
}
