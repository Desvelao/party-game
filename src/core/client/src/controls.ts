import {
  isDefaultControls,
  sanitizeControls,
  defaultControls,
  type Controls,
} from '../../shared';
import { cachedProfile, isGuest, loadProfileKey, saveProfile } from './profile';

export const CONTROLS_KEY = 'party-game:controls';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Guests keep their keys for the tab only (like the guest flag itself); everyone else in the browser. */
function storeFor(guest: boolean): Store | undefined {
  try {
    return guest ? sessionStorage : localStorage;
  } catch {
    return undefined;
  }
}

let memory: Controls | null = null; // page-lifetime copy, used when storage is unavailable
const listeners = new Set<() => void>();

/** Called whenever the controls change (the input controller re-reads them). */
export function onControlsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readStore(store: Store | undefined): Controls | null {
  try {
    const raw = store?.getItem(CONTROLS_KEY);
    return raw ? sanitizeControls(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Current controls: guests -> this tab's storage; others -> profile cache, then local storage; else defaults. */
export function loadControls(guest: boolean = isGuest()): Controls {
  if (memory) return memory;
  const fromStore = readStore(storeFor(guest));
  if (fromStore) return fromStore;
  if (!guest) {
    const fromProfile = cachedProfile()?.controls;
    if (fromProfile) return sanitizeControls(fromProfile);
  }
  return defaultControls();
}

function remember(c: Controls, guest: boolean): void {
  memory = c;
  const store = storeFor(guest);
  try {
    if (isDefaultControls(c)) store?.removeItem(CONTROLS_KEY);
    else store?.setItem(CONTROLS_KEY, JSON.stringify(c));
  } catch {
    /* private mode / quota: the in-memory copy still serves this page */
  }
  listeners.forEach((f) => f());
}

/**
 * Save new controls. Always kept in the browser; sent to the profile only for registered players
 * that already have a saved profile (changing a key never creates a server record).
 */
export async function saveControls(c: Controls, guest: boolean = isGuest()): Promise<Controls> {
  const clean = sanitizeControls(c);
  remember(clean, guest);
  if (!guest && cachedProfile()) {
    try {
      const rec = await saveProfile(loadProfileKey(), { controls: clean });
      const stored = rec.controls ? sanitizeControls(rec.controls) : defaultControls();
      remember(stored, guest);
      return stored;
    } catch {
      /* offline: the local copy is already saved */
    }
  }
  return clean;
}

export function resetControls(guest: boolean = isGuest()): Promise<Controls> {
  return saveControls(defaultControls(), guest);
}

/** Adopt the controls saved in a profile fetched from the server (no-op when it has none). */
export function adoptProfileControls(rec: { controls?: unknown } | null): void {
  if (isGuest() || !rec?.controls) return;
  remember(sanitizeControls(rec.controls), false);
}

/** Test hook: forget the page-lifetime copy. */
export function _resetControlsMemory(): void {
  memory = null;
}
