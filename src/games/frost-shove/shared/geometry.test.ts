import { describe, expect, it } from 'vitest';
import { polarEdge } from './geometry';

type Point = [number, number];

function expectPoint(actual: [number, number], expected: [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe('polarEdge', () => {
  const sectors = [100, 200, 300, 400];
  const step = (Math.PI * 2) / sectors.length;

  it('returns the sector radius at the centre angle of each sector', () => {
    sectors.forEach((r, i) => expect(polarEdge(sectors, i * step)).toBeCloseTo(r, 9));
  });

  it('interpolates linearly halfway between adjacent sectors', () => {
    expect(polarEdge(sectors, step * 0.5)).toBeCloseTo(150, 9);
    expect(polarEdge(sectors, step * 1.25)).toBeCloseTo(225, 9);
    expect(polarEdge(sectors, step * 2.75)).toBeCloseTo(375, 9);
  });

  it('wraps the last sector back to the first', () => {
    // halfway between sector 3 (400) and sector 0 (100)
    expect(polarEdge(sectors, step * 3.5)).toBeCloseTo(250, 9);
  });

  it('is continuous across sector boundaries from both sides', () => {
    const eps = 1e-9;
    for (let i = 0; i <= sectors.length; i++) {
      const a = i * step;
      const at = polarEdge(sectors, a);
      expect(polarEdge(sectors, a - eps)).toBeCloseTo(at, 5);
      expect(polarEdge(sectors, a + eps)).toBeCloseTo(at, 5);
    }
  });

  it('is periodic: a, a + 2PI and a - 2PI agree, also for negative and large angles', () => {
    const tau = Math.PI * 2;
    for (const a of [0, 0.3, 1.7, 3, 5.9, -0.3, -2.2]) {
      const base = polarEdge(sectors, a);
      expect(polarEdge(sectors, a + tau)).toBeCloseTo(base, 9);
      expect(polarEdge(sectors, a - tau)).toBeCloseTo(base, 9);
      expect(polarEdge(sectors, a + 5 * tau)).toBeCloseTo(base, 9);
      expect(polarEdge(sectors, a - 5 * tau)).toBeCloseTo(base, 9);
    }
  });

  it('maps negative angles onto the equivalent positive angle', () => {
    expect(polarEdge(sectors, -step)).toBeCloseTo(sectors[3], 9);
    expect(polarEdge(sectors, -step * 0.5)).toBeCloseTo(250, 9);
  });

  it('returns the constant radius for uniform sectors', () => {
    const flat = [250, 250, 250, 250, 250, 250];
    for (const a of [-7, -1, 0, 0.4, 3.3, 9]) expect(polarEdge(flat, a)).toBeCloseTo(250, 9);
  });

  it('always stays within the min/max sector radius', () => {
    for (let a = -10; a < 10; a += 0.37) {
      const r = polarEdge(sectors, a);
      expect(r).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(r).toBeLessThanOrEqual(400 + 1e-9);
    }
  });

  it('handles a single sector', () => {
    expect(polarEdge([123], 2.5)).toBeCloseTo(123, 9);
    expect(polarEdge([123], -2.5)).toBeCloseTo(123, 9);
  });
});
