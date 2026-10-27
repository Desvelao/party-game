import { describe, expect, it } from 'vitest';
import { MUTE_KEY, loadMuted, saveMuted } from './mute';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const broken = {
  getItem: (): string | null => {
    throw new Error('denied');
  },
  setItem: (): void => {
    throw new Error('denied');
  },
};

describe('mute persistence', () => {
  it('defaults to unmuted', () => {
    expect(loadMuted(mem())).toBe(false);
  });
  it('round-trips', () => {
    const s = mem();
    saveMuted(true, s);
    expect(s.getItem(MUTE_KEY)).toBe('1');
    expect(loadMuted(s)).toBe(true);
    saveMuted(false, s);
    expect(loadMuted(s)).toBe(false);
  });
  it('treats garbage as unmuted', () => {
    const s = mem();
    s.setItem(MUTE_KEY, 'yes');
    expect(loadMuted(s)).toBe(false);
  });
  it('does not throw when storage is unavailable', () => {
    expect(loadMuted(broken)).toBe(false);
    expect(() => saveMuted(true, broken)).not.toThrow();
  });
});
