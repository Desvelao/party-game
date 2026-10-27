/**
 * Builders for the `Shape`s a character model draws (`CharacterDraw`). Coordinates are given in units of the body
 * radius along the facing (u: forward, v: sideways), so a model is written once and turns with the player.
 */
import type { Shape } from './looks';

export interface ShapePen {
  circle(u: number, v: number, rad: number, fill: number): Shape;
  /** a polygon from `u, v` pairs */
  poly(fill: number, ...uv: number[]): Shape;
  /** an axis-aligned rectangle in (u, v) */
  rect(u0: number, v0: number, u1: number, v1: number, fill: number): Shape;
  /** a regular polygon of `n` sides around the centre, `rot` radians off the facing */
  regular(n: number, rad: number, fill: number, rot?: number): Shape;
}

/** A pen for a character of radius `r` looking along `facing` (radians), centred on (0,0). */
export function shapePen(r: number, facing: number): ShapePen {
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const x = (u: number, v: number) => (cos * u - sin * v) * r;
  const y = (u: number, v: number) => (sin * u + cos * v) * r;
  const poly = (fill: number, ...uv: number[]): Shape => {
    const pts: number[] = [];
    for (let i = 0; i < uv.length; i += 2) pts.push(x(uv[i], uv[i + 1]), y(uv[i], uv[i + 1]));
    return { k: 'poly', pts, fill };
  };
  return {
    circle: (u, v, rad, fill) => ({ k: 'circle', x: x(u, v), y: y(u, v), r: rad * r, fill }),
    poly,
    rect: (u0, v0, u1, v1, fill) => poly(fill, u0, v0, u1, v0, u1, v1, u0, v1),
    regular: (n, rad, fill, rot = 0) => {
      const uv: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        uv.push(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      return poly(fill, ...uv);
    },
  };
}
