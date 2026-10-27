import { describe, expect, it } from 'vitest';
import { mulberry32, nextIn } from './util';

describe('nextIn', () => {
  it('is exactly the interval with no variance', () => {
    expect(nextIn(() => 0.9, 7, 0)).toBe(7);
  });

  it('stays within interval +- variance', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      const v = nextIn(rng, 10, 3);
      expect(v).toBeGreaterThanOrEqual(7);
      expect(v).toBeLessThanOrEqual(13);
    }
  });

  it('never goes under the minimum gap', () => {
    expect(nextIn(() => 0, 2, 10, 1)).toBe(1);
    expect(nextIn(() => 0, 2, 10)).toBe(0.5);
  });

  it('does not consume the rng without variance', () => {
    let calls = 0;
    nextIn(() => (calls++, 0.5), 7, 0);
    expect(calls).toBe(0);
  });
});
