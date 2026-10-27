import { beforeEach, describe, expect, it } from 'vitest';
import { hasSeenHowTo, markHowToSeen, HOWTO_SEEN_KEY } from './howto-seen';

describe('how-to-play seen flags', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = (() => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    })();
  });

  it('is false until marked, then remembered per id', () => {
    expect(hasSeenHowTo('smashball-x')).toBe(false);
    markHowToSeen('smashball-x');
    expect(hasSeenHowTo('smashball-x')).toBe(true);
    expect(hasSeenHowTo('other')).toBe(false);
    expect(JSON.parse(localStorage.getItem(HOWTO_SEEN_KEY)!)).toContain('smashball-x');
  });
});
