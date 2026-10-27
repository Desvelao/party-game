import { describe, expect, it } from 'vitest';
import { shouldCaptureKey } from './keycapture';

describe('shouldCaptureKey', () => {
  it('captures on body/canvas/dash while a round runs', () => {
    for (const phase of ['countdown', 'playing']) {
      expect(shouldCaptureKey(phase, { tagName: 'BODY' })).toBe(true);
      expect(shouldCaptureKey(phase, { tagName: 'CANVAS' })).toBe(true);
      expect(shouldCaptureKey(phase, { tagName: 'BUTTON', id: 'dash' })).toBe(true);
      expect(shouldCaptureKey(phase, null)).toBe(true);
    }
  });
  it('never captures in form controls', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA', 'input']) {
      expect(shouldCaptureKey('playing', { tagName })).toBe(false);
    }
    expect(shouldCaptureKey('playing', { tagName: 'DIV', isContentEditable: true })).toBe(false);
  });
  it('on other buttons, leaves Space/Enter to the button but captures movement keys', () => {
    const btn = { tagName: 'BUTTON', id: 'menu-btn' };
    expect(shouldCaptureKey('playing', btn, 'Space')).toBe(false);
    expect(shouldCaptureKey('playing', btn, 'Enter')).toBe(false);
    expect(shouldCaptureKey('playing', btn, 'KeyW')).toBe(true);
    expect(shouldCaptureKey('playing', btn, 'ArrowLeft')).toBe(true);
    expect(shouldCaptureKey('playing', { tagName: 'INPUT' }, 'KeyW')).toBe(false);
  });
  it('does not capture outside countdown/playing', () => {
    for (const phase of ['lobby', 'results', 'finished']) {
      expect(shouldCaptureKey(phase, { tagName: 'BODY' })).toBe(false);
    }
  });
});
