import {
  defaultTouchPrefs,
  isDefaultTouchPrefs,
  sanitizeTouchPrefs,
  type TouchPrefs,
} from '../../shared';
import { cachedProfile, isGuest, loadProfileKey, saveProfile } from './profile';

export const TOUCH_PREFS_KEY = 'party-game:touch-prefs';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Guests keep their preferences for the tab only; everyone else in the browser. */
function storeFor(guest: boolean): Store | undefined {
  try {
    return guest ? sessionStorage : localStorage;
  } catch {
    return undefined;
  }
}

let memory: TouchPrefs | null = null; // page-lifetime copy, used when storage is unavailable
const listeners = new Set<() => void>();

/** Called whenever the preferences change. */
export function onTouchPrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readStore(store: Store | undefined): TouchPrefs | null {
  try {
    const raw = store?.getItem(TOUCH_PREFS_KEY);
    return raw ? sanitizeTouchPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Current preferences: this tab/browser's storage, then the profile cache, else defaults. */
export function loadTouchPrefs(guest: boolean = isGuest()): TouchPrefs {
  if (memory) return memory;
  const fromStore = readStore(storeFor(guest));
  if (fromStore) return fromStore;
  if (!guest) {
    const fromProfile = cachedProfile()?.touch;
    if (fromProfile) return sanitizeTouchPrefs(fromProfile);
  }
  return defaultTouchPrefs();
}

function remember(p: TouchPrefs, guest: boolean): void {
  memory = p;
  const store = storeFor(guest);
  try {
    if (isDefaultTouchPrefs(p)) store?.removeItem(TOUCH_PREFS_KEY);
    else store?.setItem(TOUCH_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota: the in-memory copy still serves this page */
  }
  listeners.forEach((f) => f());
}

/** Save preferences; sent to the profile only for registered players that already have one. */
export async function saveTouchPrefs(p: TouchPrefs, guest: boolean = isGuest()): Promise<TouchPrefs> {
  const clean = sanitizeTouchPrefs(p);
  remember(clean, guest);
  if (!guest && cachedProfile()) {
    try {
      const rec = await saveProfile(loadProfileKey(), { touch: clean });
      const stored = rec.touch ? sanitizeTouchPrefs(rec.touch) : defaultTouchPrefs();
      remember(stored, guest);
      return stored;
    } catch {
      /* offline: the local copy is already saved */
    }
  }
  return clean;
}

/** Adopt the preferences saved in a profile fetched from the server (no-op when it has none). */
export function adoptProfileTouchPrefs(rec: { touch?: unknown } | null): void {
  if (isGuest() || !rec?.touch) return;
  remember(sanitizeTouchPrefs(rec.touch), false);
}

/** Test hook: forget the page-lifetime copy. */
export function _resetTouchPrefsMemory(): void {
  memory = null;
}

/**
 * Is this a touch-first device (phone/tablet)? Coarse primary pointer, or touch points with no
 * fine pointer. Laptops with a touch screen keep a mouse, so they stay "not touch" (toggle available).
 * Also flips to true on the first real touch.
 */
let touchSeen = false;
export function isTouchDevice(): boolean {
  if (touchSeen) return true;
  try {
    if (matchMedia('(pointer: coarse)').matches) return true;
    if (navigator.maxTouchPoints > 0 && !matchMedia('(any-pointer: fine)').matches) return true;
  } catch {
    /* no matchMedia (tests) */
  }
  return false;
}

export function _markTouchSeen(): void {
  touchSeen = true;
}
