import { describe, expect, it } from 'vitest';
import { installMode } from './install';

const base = { standalone: false, hasPrompt: false, ios: false, secure: true };

describe('installMode', () => {
  it('offers the prompt when the browser handed one over', () => {
    expect(installMode({ ...base, hasPrompt: true })).toBe('prompt');
  });
  it('offers nothing once installed', () => {
    expect(installMode({ ...base, standalone: true, hasPrompt: true })).toBe('none');
    expect(installMode({ ...base, standalone: true, ios: true })).toBe('none');
  });
  it('explains Add to Home Screen on iOS, but only on a secure page', () => {
    expect(installMode({ ...base, ios: true })).toBe('ios');
    expect(installMode({ ...base, ios: true, secure: false })).toBe('none');
  });
  it('offers nothing where the browser has no install', () => {
    expect(installMode(base)).toBe('none');
  });
});
