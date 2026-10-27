import { describe, expect, it } from 'vitest';
import { PALETTE } from './character';
import { COLORBLIND_PALETTE, defaultAccessPrefs, isDefaultAccessPrefs, markerFor, resolveMotion, sanitizeAccessPrefs, shakeScale } from './access-prefs';

describe('access prefs', () => {
  it('defaults to everything off and sanitizes junk', () => {
    expect(isDefaultAccessPrefs(defaultAccessPrefs())).toBe(true);
    expect(sanitizeAccessPrefs(null)).toEqual(defaultAccessPrefs());
    expect(sanitizeAccessPrefs({ colorblind: 'yes', markers: true, extra: 1 })).toEqual({ colorblind: false, markers: true, motion: 'auto' });
  });

  it('has a colour-blind colour for every palette slot, all distinct', () => {
    expect(COLORBLIND_PALETTE).toHaveLength(PALETTE.length);
    expect(new Set(COLORBLIND_PALETTE).size).toBe(PALETTE.length);
  });

  it('markers combine a shape and the seat number', () => {
    expect(markerFor(0)).toBe('●1');
    expect(markerFor(1)).toBe('▲2');
    expect(markerFor(9)).toBe('▲10');
  });

  it('resolves the motion level against the device preference', () => {
    expect(sanitizeAccessPrefs({ motion: 'low' }).motion).toBe('low');
    expect(sanitizeAccessPrefs({ motion: 'wild' }).motion).toBe('auto');
    expect(resolveMotion('auto', true)).toBe('off');
    expect(resolveMotion('auto', false)).toBe('normal');
    expect(resolveMotion('low', true)).toBe('low');
    expect([shakeScale('off', false), shakeScale('low', false), shakeScale('normal', true), shakeScale('auto', true)]).toEqual([0, 0.4, 1, 0]);
  });
});
