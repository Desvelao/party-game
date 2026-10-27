import { describe, expect, it } from 'vitest';
import { WORLD_SIZE } from '../../../core/shared/constants';
import { CORNER_SIZE, FIELD_HALF, cornerCenter, fieldCorner, rotQuarter } from './geometry';

type Point = [number, number];

function expectPoint(actual: [number, number], expected: [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe('rotQuarter', () => {
  it('maps the documented quarter turns (screen space, y down)', () => {
    expectPoint(rotQuarter(3, 5, 0), [3, 5]);
    expectPoint(rotQuarter(3, 5, 1), [-5, 3]);
    expectPoint(rotQuarter(3, 5, 2), [-3, -5]);
    expectPoint(rotQuarter(3, 5, 3), [5, -3]);
  });

  it('maps the bottom edge onto the left edge for k=1', () => {
    expectPoint(rotQuarter(0, 1, 1), [-1, 0]);
  });

  it('treats k and k +/- 4 identically, including negative k', () => {
    for (let k = -9; k <= 9; k++) {
      expectPoint(rotQuarter(7, -2, k), rotQuarter(7, -2, k + 4));
      expectPoint(rotQuarter(7, -2, k), rotQuarter(7, -2, k - 4));
    }
    expectPoint(rotQuarter(7, -2, -1), rotQuarter(7, -2, 3));
    expectPoint(rotQuarter(7, -2, -2), rotQuarter(7, -2, 2));
    expectPoint(rotQuarter(7, -2, -3), rotQuarter(7, -2, 1));
    expectPoint(rotQuarter(7, -2, -4), [7, -2]);
    expectPoint(rotQuarter(7, -2, 8), [7, -2]);
  });

  it('returns the original point after four successive quarter turns', () => {
    let p: [number, number] = [12.5, -33];
    for (let i = 0; i < 4; i++) p = rotQuarter(p[0], p[1], 1);
    expectPoint(p, [12.5, -33]);
  });

  it('composes: k=a then k=b equals k=a+b, and k then -k is the identity', () => {
    const [x, y] = rotQuarter(4, 9, 1);
    expectPoint(rotQuarter(x, y, 2), rotQuarter(4, 9, 3));
    const [rx, ry] = rotQuarter(4, 9, 3);
    expectPoint(rotQuarter(rx, ry, -3), [4, 9]);
  });

  it('preserves distance from the origin and fixes the origin', () => {
    for (let k = -4; k <= 4; k++) {
      const [x, y] = rotQuarter(3, 4, k);
      expect(Math.hypot(x, y)).toBeCloseTo(5, 9);
    }
    expectPoint(rotQuarter(0, 0, 3), [0, 0]);
  });
});

describe('cornerCenter', () => {
  const c = WORLD_SIZE / 2;
  const o = FIELD_HALF - CORNER_SIZE / 2;

  it('places the four corner blocks at the field corners (TL, TR, BR, BL)', () => {
    expectPoint(cornerCenter(0), [c - o, c - o]);
    expectPoint(cornerCenter(1), [c + o, c - o]);
    expectPoint(cornerCenter(2), [c + o, c + o]);
    expectPoint(cornerCenter(3), [c - o, c + o]);
  });

  it('is symmetric about the world centre (opposite corners mirror each other)', () => {
    const [a, b] = [cornerCenter(0), cornerCenter(2)];
    expect(a[0] + b[0]).toBeCloseTo(WORLD_SIZE, 9);
    expect(a[1] + b[1]).toBeCloseTo(WORLD_SIZE, 9);
    const [d, e] = [cornerCenter(1), cornerCenter(3)];
    expect(d[0] + e[0]).toBeCloseTo(WORLD_SIZE, 9);
    expect(d[1] + e[1]).toBeCloseTo(WORLD_SIZE, 9);
  });

  it('keeps the whole block inside the field', () => {
    for (let i = 0; i < 4; i++) {
      const [x, y] = cornerCenter(i);
      expect(Math.abs(x - c) + CORNER_SIZE / 2).toBeCloseTo(FIELD_HALF, 9);
      expect(Math.abs(y - c) + CORNER_SIZE / 2).toBeCloseTo(FIELD_HALF, 9);
    }
  });

  it('agrees with rotQuarter: one quarter turn about the world centre advances the corner', () => {
    for (let i = 0; i < 4; i++) {
      const [x, y] = cornerCenter(i);
      const [rx, ry] = rotQuarter(x - c, y - c, 1);
      expectPoint([c + rx, c + ry], cornerCenter((i + 1) % 4));
    }
  });
});
