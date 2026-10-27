import { describe, expect, it } from 'vitest';
import { PoorConnectionWatch, barsOf, qualityOf } from './netquality';

describe('connection quality', () => {
  it('maps round-trip times to levels and bars', () => {
    expect(qualityOf(0)).toBe('unknown');
    expect(qualityOf(30)).toBe('good');
    expect(qualityOf(100)).toBe('fair');
    expect(qualityOf(200)).toBe('weak');
    expect(qualityOf(450)).toBe('poor');
    expect([qualityOf(0), qualityOf(30), qualityOf(100), qualityOf(200), qualityOf(450)].map(barsOf)).toEqual([0, 4, 3, 2, 1]);
  });

  it('warns after a streak of poor samples, then only after the cooldown', () => {
    const w = new PoorConnectionWatch(3, 1000);
    expect([w.sample('poor', 0), w.sample('poor', 10), w.sample('poor', 20)]).toEqual([false, false, true]);
    expect(w.sample('poor', 30)).toBe(false); // cooldown
    expect(w.sample('good', 40)).toBe(false); // streak reset
    expect([w.sample('poor', 2000), w.sample('poor', 2010), w.sample('poor', 2020)]).toEqual([false, false, true]);
  });
});
