import { describe, expect, it } from 'vitest';
import { ALL_PLAYABLES } from '../../../shared';
import { TRACKS } from './music';

describe('music tracks', () => {
  it('belong to real game families and have consistent patterns', () => {
    const families = new Set(ALL_PLAYABLES.map((p) => p.game));
    for (const [id, t] of Object.entries(TRACKS)) {
      expect(families.has(id), id).toBe(true);
      expect(t.melody).toHaveLength(t.bass.length);
      for (const s of [...t.kick, ...t.snare, ...t.hat]) expect(s).toBeLessThan(t.bass.length);
      expect(t.bpm).toBeGreaterThan(40);
      // a loop of a few seconds
      const seconds = (t.bass.length * 60) / t.bpm / 2;
      expect(seconds).toBeGreaterThan(2);
      expect(seconds).toBeLessThan(12);
    }
  });
});
