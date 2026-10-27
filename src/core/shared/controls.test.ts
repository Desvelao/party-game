import { describe, expect, it } from 'vitest';
import {
  CONTROL_ACTIONS,
  DEFAULT_CONTROLS,
  MAX_KEYS_PER_ACTION,
  defaultControls,
  findConflict,
  isBindableCode,
  isDefaultControls,
  sameControls,
  sanitizeControls,
} from './controls';

describe('isBindableCode', () => {
  it.each(['KeyA', 'ArrowUp', 'Space', 'Digit4', 'Numpad5', 'Enter', 'Quote'])('accepts %s', (c) => {
    expect(isBindableCode(c)).toBe(true);
  });
  it.each([
    'ControlLeft', 'ControlRight', 'MetaLeft', 'AltRight', 'ShiftLeft', 'Tab', 'Escape', 'F5', 'F12', 'ContextMenu', 'CapsLock', 'PrintScreen',
    '', 'Key A', 'a'.repeat(40), '<script>',
  ])('rejects %j', (c) => {
    expect(isBindableCode(c)).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isBindableCode(5)).toBe(false);
    expect(isBindableCode(null)).toBe(false);
    expect(isBindableCode({})).toBe(false);
  });
});

describe('defaults', () => {
  it('are valid, within the cap, free of conflicts and no longer use Ctrl', () => {
    const seen = new Set<string>();
    for (const a of CONTROL_ACTIONS) {
      expect(DEFAULT_CONTROLS[a].length).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_CONTROLS[a].length).toBeLessThanOrEqual(MAX_KEYS_PER_ACTION);
      for (const c of DEFAULT_CONTROLS[a]) {
        expect(isBindableCode(c)).toBe(true);
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
    expect([...seen].some((c) => c.startsWith('Control'))).toBe(false);
  });
  it('defaultControls returns an independent copy', () => {
    const c = defaultControls();
    c.up.push('KeyX');
    expect(DEFAULT_CONTROLS.up).not.toContain('KeyX');
    expect(isDefaultControls(defaultControls())).toBe(true);
  });
});

describe('sanitizeControls', () => {
  it('returns the defaults for junk', () => {
    for (const raw of [undefined, null, 5, 'x', [], {}, { up: 'KeyW' }, { up: [1, 2] }]) {
      expect(sanitizeControls(raw)).toEqual(DEFAULT_CONTROLS);
    }
  });
  it('keeps valid custom bindings', () => {
    const c = sanitizeControls({ action: ['KeyF'], action2: ['KeyG', 'KeyH'] });
    expect(c.action).toEqual(['KeyF']);
    expect(c.action2).toEqual(['KeyG', 'KeyH']);
    expect(c.up).toEqual(DEFAULT_CONTROLS.up);
  });
  it('drops reserved and malformed keys, dedupes and caps', () => {
    const c = sanitizeControls({ action: ['ControlLeft', 'KeyF', 'KeyF', 'KeyG', 'KeyH', 'F5'] });
    expect(c.action).toEqual(['KeyF', 'KeyG']);
  });
  it('an action left with no valid key gets its default back', () => {
    const c = sanitizeControls({ action2: ['ControlLeft', 'Tab'] });
    expect(c.action2).toEqual(DEFAULT_CONTROLS.action2);
  });
  it('a key already used by an earlier action is dropped from the later one', () => {
    const c = sanitizeControls({ up: ['KeyZ'], action: ['KeyZ', 'KeyM'] });
    expect(c.up).toEqual(['KeyZ']);
    expect(c.action).toEqual(['KeyM']);
  });
  it('ignores unknown actions', () => {
    expect(sanitizeControls({ bogus: ['KeyQ'] })).toEqual(DEFAULT_CONTROLS);
  });
});

describe('findConflict / sameControls', () => {
  it('finds the other action that owns a key', () => {
    expect(findConflict(DEFAULT_CONTROLS, 'action', 'KeyE')).toBe('action2');
    expect(findConflict(DEFAULT_CONTROLS, 'action2', 'KeyE')).toBeUndefined();
    expect(findConflict(DEFAULT_CONTROLS, 'up', 'KeyQ')).toBeUndefined();
  });
  it('compares bindings ignoring order inside an action', () => {
    const a = defaultControls();
    const b = defaultControls();
    b.up = [...b.up].reverse();
    expect(sameControls(a, b)).toBe(true);
    b.up = ['KeyI'];
    expect(sameControls(a, b)).toBe(false);
  });
});
