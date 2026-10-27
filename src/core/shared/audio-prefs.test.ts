import { describe, expect, it } from 'vitest';
import { defaultAudioPrefs, isDefaultAudioPrefs, sanitizeAudioPrefs } from './audio-prefs';

describe('audio prefs', () => {
  it('defaults to full volume', () => {
    expect(defaultAudioPrefs()).toEqual({ master: 100, sfx: 100, music: 100 });
    expect(isDefaultAudioPrefs(sanitizeAudioPrefs(undefined))).toBe(true);
  });

  it('clamps, rounds and falls back per field', () => {
    expect(sanitizeAudioPrefs({ master: 150, sfx: -5, music: 33.4 })).toEqual({ master: 100, sfx: 0, music: 33 });
    expect(sanitizeAudioPrefs({ master: 'loud', sfx: NaN, music: 20 })).toEqual({ master: 100, sfx: 100, music: 20 });
  });
});
