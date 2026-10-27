import { describe, expect, it } from 'vitest';
import { MAX_STEPS, sanitizeSound } from './recipe';

describe('sanitizeSound', () => {
  it('keeps a valid tone and fills in the defaults', () => {
    expect(sanitizeSound([{ k: 'tone', f: 440, d: 0.2 }])).toEqual([{ k: 'tone', f: 440, type: 'sine', d: 0.2, g: 0.1, at: 0 }]);
  });
  it('keeps a valid noise burst', () => {
    expect(sanitizeSound([{ k: 'noise', d: 0.3, g: 0.2, from: 2000, to: 300, at: 0.1 }])).toEqual([{ k: 'noise', from: 2000, to: 300, d: 0.3, g: 0.2, at: 0.1 }]);
  });
  it('clamps values to the limits', () => {
    const [s] = sanitizeSound([{ k: 'tone', f: 5, to: 99999, d: 9, g: 5, at: 50, type: 'square' }]);
    expect(s).toMatchObject({ f: 40, to: 8000, d: 1.5, g: 0.35, at: 2, type: 'square' });
    const [n] = sanitizeSound([{ k: 'noise', d: 0.001, from: 1, to: 1e9 }]);
    expect(n).toMatchObject({ from: 80, to: 12000, d: 0.02 });
  });
  it('falls back to a sine for an unknown waveform', () => {
    expect(sanitizeSound([{ k: 'tone', f: 300, d: 0.1, type: 'laser' }])[0]).toMatchObject({ type: 'sine' });
  });
  it('drops junk instead of throwing', () => {
    expect(sanitizeSound(null)).toEqual([]);
    expect(sanitizeSound('boom')).toEqual([]);
    expect(sanitizeSound([null, 5, 'x', {}, { k: 'tone' }, { k: 'tone', f: NaN, d: 1 }, { k: 'noise', d: 1, from: 100 }, { k: 'other', d: 1 }])).toEqual([]);
  });
  it('keeps at most MAX_STEPS steps', () => {
    const many = Array.from({ length: 40 }, () => ({ k: 'tone', f: 300, d: 0.1 }));
    expect(sanitizeSound(many)).toHaveLength(MAX_STEPS);
  });
});
