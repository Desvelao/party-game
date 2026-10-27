import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOUCH_PREFS,
  defaultTouchPrefs,
  isDefaultTouchPrefs,
  resolveMoveControl,
  resolveShowControls,
  sanitizeTouchPrefs,
} from './touch-controls';

describe('sanitizeTouchPrefs', () => {
  it('falls back to defaults for junk', () => {
    expect(sanitizeTouchPrefs(null)).toEqual(DEFAULT_TOUCH_PREFS);
    expect(sanitizeTouchPrefs({ show: 'x', move: 5, perGame: [] })).toEqual(DEFAULT_TOUCH_PREFS);
  });
  it('keeps valid values and drops invalid per-game entries', () => {
    const p = sanitizeTouchPrefs({ show: 'on', move: 'cross', perGame: { 'tank-wars': 'joystick', 'Bad Id': 'cross', ballistix: 'auto' } });
    expect(p).toEqual({ ...defaultTouchPrefs(), show: 'on', move: 'cross', perGame: { 'tank-wars': 'joystick' } });
    expect(isDefaultTouchPrefs(p)).toBe(false);
    expect(isDefaultTouchPrefs(sanitizeTouchPrefs({}))).toBe(true);
  });
  it('floating joystick is opt-in and only a real true counts', () => {
    expect(defaultTouchPrefs().floating).toBe(false);
    expect(sanitizeTouchPrefs({ floating: 'yes' }).floating).toBe(false);
    const on = sanitizeTouchPrefs({ floating: true });
    expect(on.floating).toBe(true);
    expect(isDefaultTouchPrefs(on)).toBe(false);
  });
});

describe('resolveMoveControl', () => {
  it('per-game > global > hint > joystick', () => {
    const base = { ...DEFAULT_TOUCH_PREFS };
    expect(resolveMoveControl(base, 'tank-wars')).toBe('joystick');
    expect(resolveMoveControl(base, 'tank-wars', 'cross')).toBe('cross');
    expect(resolveMoveControl({ ...base, move: 'joystick' }, 'tank-wars', 'cross')).toBe('joystick');
    expect(resolveMoveControl({ ...base, move: 'joystick', perGame: { 'tank-wars': 'cross' } }, 'tank-wars', undefined)).toBe('cross');
    expect(resolveMoveControl({ ...base, perGame: { 'tank-wars': 'cross' } }, 'ballistix', undefined)).toBe('joystick');
  });
});

describe('resolveShowControls', () => {
  it('is forced on touch screens and opt-in elsewhere', () => {
    expect(resolveShowControls({ ...DEFAULT_TOUCH_PREFS, show: 'off' }, true)).toBe(true);
    expect(resolveShowControls(DEFAULT_TOUCH_PREFS, false)).toBe(false);
    expect(resolveShowControls({ ...DEFAULT_TOUCH_PREFS, show: 'on' }, false)).toBe(true);
  });
});

describe('layout and haptics prefs', () => {
  it('defaults to a medium, opaque, right-handed layout with haptics on', () => {
    expect(defaultTouchPrefs()).toMatchObject({ size: 'medium', opacity: 100, hand: 'right', haptics: true });
  });
  it('keeps valid values and clamps or drops invalid ones', () => {
    expect(sanitizeTouchPrefs({ size: 'large', opacity: 50, hand: 'left', haptics: false })).toMatchObject({
      size: 'large', opacity: 50, hand: 'left', haptics: false,
    });
    expect(sanitizeTouchPrefs({ opacity: 5 }).opacity).toBe(30);
    expect(sanitizeTouchPrefs({ opacity: 500 }).opacity).toBe(100);
    expect(sanitizeTouchPrefs({ opacity: 'x', size: 'huge', hand: 'up', haptics: 'no' })).toEqual(defaultTouchPrefs());
  });
  it('is no longer default once a layout option changes', () => {
    expect(isDefaultTouchPrefs({ ...defaultTouchPrefs(), hand: 'left' })).toBe(false);
    expect(isDefaultTouchPrefs({ ...defaultTouchPrefs(), haptics: false })).toBe(false);
  });
});
