import { describe, expect, it } from 'vitest';
import { circleAABB, circleBar, circleCircle } from './collision';

describe('collision', () => {
  it('circle/circle', () => {
    expect(circleCircle(0, 0, 10, 15, 0, 10)).toBe(true);
    expect(circleCircle(0, 0, 10, 25, 0, 10)).toBe(false);
  });
  it('circle/aabb', () => {
    expect(circleAABB(5, 5, 2, 0, 0, 10, 10)).toBe(true);
    expect(circleAABB(14, 5, 3, 0, 0, 10, 10)).toBe(false);
    expect(circleAABB(12, 5, 3, 0, 0, 10, 10)).toBe(true);
  });
  it('circle/bar rotated', () => {
    // bar along +y (angle = 90deg), from origin, length 100
    const hit = circleBar(8, 50, 10, 0, 0, Math.PI / 2, 100, 5);
    expect(hit.hit).toBe(true);
    expect(hit.nx).toBeGreaterThan(0.9); // pushed towards +x
    expect(circleBar(30, 50, 10, 0, 0, Math.PI / 2, 100, 5).hit).toBe(false);
    expect(circleBar(0, 130, 10, 0, 0, Math.PI / 2, 100, 5).hit).toBe(false);
  });
});
