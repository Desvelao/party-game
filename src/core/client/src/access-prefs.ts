import { defaultAccessPrefs, isDefaultAccessPrefs, sanitizeAccessPrefs, type AccessPrefs } from '../../shared';
import { cachedProfile, isGuest, loadProfileKey, saveProfile } from './profile';

export const ACCESS_PREFS_KEY = 'party-game:access-prefs';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Guests keep their options for the tab only (like the guest flag itself); everyone else in the browser. */
function storeFor(guest: boolean): Store | undefined {
  try {
    return guest ? sessionStorage : localStorage;
  } catch {
    return undefined;
  }
}

let memory: AccessPrefs | null = null; // page-lifetime copy, used when storage is unavailable
const listeners = new Set<() => void>();

/** Called whenever the accessibility options change. */
export function onAccessPrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readStore(store: Store | undefined): AccessPrefs | null {
  try {
    const raw = store?.getItem(ACCESS_PREFS_KEY);
    return raw ? sanitizeAccessPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Current options: guests -> this tab's storage; others -> this browser's storage, then the profile cache; else defaults. */
export function loadAccessPrefs(guest: boolean = isGuest()): AccessPrefs {
  if (memory) return memory;
  const fromStore = readStore(storeFor(guest));
  if (fromStore) return fromStore;
  if (!guest) {
    const fromProfile = cachedProfile()?.access;
    if (fromProfile) return sanitizeAccessPrefs(fromProfile);
  }
  return defaultAccessPrefs();
}

function remember(k: AccessPrefs, guest: boolean): void {
  memory = k;
  const store = storeFor(guest);
  try {
    if (isDefaultAccessPrefs(k)) store?.removeItem(ACCESS_PREFS_KEY);
    else store?.setItem(ACCESS_PREFS_KEY, JSON.stringify(k));
  } catch {
    /* private mode / quota: the in-memory copy still serves this page */
  }
  listeners.forEach((f) => f());
}

/**
 * Save new options. Always kept in the browser (the tab only for guests); sent to the profile only for
 * registered players that already have a saved profile (changing a key never creates a server record).
 */
export async function saveAccessPrefs(keys: AccessPrefs, guest: boolean = isGuest()): Promise<AccessPrefs> {
  const clean = sanitizeAccessPrefs(keys);
  remember(clean, guest);
  if (!guest && cachedProfile()) {
    try {
      const rec = await saveProfile(loadProfileKey(), { access: clean });
      const stored = rec.access ? sanitizeAccessPrefs(rec.access) : defaultAccessPrefs();
      remember(stored, guest);
      return stored;
    } catch {
      /* offline: the local copy is already saved */
    }
  }
  return clean;
}

/** Adopt the options saved in a profile fetched from the server (no-op when it has none). */
export function adoptProfileAccessPrefs(rec: { access?: unknown } | null): void {
  if (isGuest() || !rec?.access) return;
  remember(sanitizeAccessPrefs(rec.access), false);
}

/** Test hook: forget the page-lifetime copy. */
export function _resetAccessPrefsMemory(): void {
  memory = null;
}
