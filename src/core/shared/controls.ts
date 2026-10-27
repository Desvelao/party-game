/**
 * Keyboard controls a player can rebind. Values are `KeyboardEvent.code` strings (layout independent).
 * Stored in the profile for registered players and in the browser (session/local storage) otherwise.
 */
export type ControlAction = 'up' | 'down' | 'left' | 'right' | 'action' | 'action2';

export type Controls = Record<ControlAction, string[]>;

export const CONTROL_ACTIONS: readonly ControlAction[] = ['up', 'down', 'left', 'right', 'action', 'action2'];

/** At most this many keys per action. */
export const MAX_KEYS_PER_ACTION = 2;

export const DEFAULT_CONTROLS: Controls = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  action: ['Space', 'KeyJ'],
  action2: ['KeyE', 'KeyL'],
};

/** Keys the browser or the page needs for itself: modifiers, focus/escape, function and system keys. */
const RESERVED = /^(Control|Meta|Alt|Shift)(Left|Right)$|^(Tab|Escape|ContextMenu|CapsLock|NumLock|ScrollLock|PrintScreen|Pause|Insert|OS(Left|Right)|F\d{1,2})$/;
const CODE_RE = /^[A-Za-z0-9]{1,24}$/;

/** Can this key be bound to a game action? */
export function isBindableCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code) && !RESERVED.test(code);
}

/** Fresh copy of the defaults. */
export function defaultControls(): Controls {
  return Object.fromEntries(CONTROL_ACTIONS.map((a) => [a, [...DEFAULT_CONTROLS[a]]])) as Controls;
}

/**
 * Validate untrusted controls. Unknown actions are ignored; an action with no valid key falls back
 * to its default; keys are de-duplicated, capped, and a key already taken by an earlier action is
 * dropped from the later one (an action left empty gets its default back).
 */
export function sanitizeControls(raw: unknown): Controls {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = defaultControls();
  const taken = new Set<string>();
  for (const action of CONTROL_ACTIONS) {
    const list = src[action];
    let keys: string[] = [];
    if (Array.isArray(list)) {
      for (const c of list) {
        if (isBindableCode(c) && !keys.includes(c) && !taken.has(c) && keys.length < MAX_KEYS_PER_ACTION) keys.push(c);
      }
    }
    if (keys.length === 0) keys = DEFAULT_CONTROLS[action].filter((c) => !taken.has(c)).slice(0, MAX_KEYS_PER_ACTION);
    out[action] = keys;
    for (const c of keys) taken.add(c);
  }
  return out;
}

/** The other action that already uses `code`, if any. */
export function findConflict(c: Controls, action: ControlAction, code: string): ControlAction | undefined {
  return CONTROL_ACTIONS.find((a) => a !== action && c[a].includes(code));
}

/** Same bindings (order inside an action ignored)? */
export function sameControls(a: Controls, b: Controls): boolean {
  return CONTROL_ACTIONS.every((k) => a[k].length === b[k].length && a[k].every((c) => b[k].includes(c)));
}

export function isDefaultControls(c: Controls): boolean {
  return sameControls(c, DEFAULT_CONTROLS);
}
