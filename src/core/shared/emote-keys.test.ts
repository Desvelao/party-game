import { describe, expect, it } from 'vitest';
import { defaultEmoteKeys, isDefaultEmoteKeys, sanitizeEmoteKeys } from './emote-keys';

describe('emote keys', () => {
  it('defaults to T and the digits', () => {
    const d = defaultEmoteKeys();
    expect(d.toggle).toBe('KeyT');
    expect(d.emotes).toEqual(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']);
    expect(isDefaultEmoteKeys(sanitizeEmoteKeys(null))).toBe(true);
  });

  it('keeps valid custom keys', () => {
    const k = sanitizeEmoteKeys({ toggle: 'KeyG', emotes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN'] });
    expect(k.toggle).toBe('KeyG');
    expect(k.emotes[0]).toBe('KeyZ');
  });

  it('rejects reserved keys and duplicates', () => {
    const k = sanitizeEmoteKeys({ toggle: 'Escape', emotes: ['KeyZ', 'KeyZ', 'F5'] });
    expect(k.toggle).toBe('KeyT');
    expect(k.emotes[0]).toBe('KeyZ');
    expect(k.emotes[1]).toBe('Digit2');
    expect(k.emotes[2]).toBe('Digit3');
  });
});
