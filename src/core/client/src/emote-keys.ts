import { defaultEmoteKeys, isDefaultEmoteKeys, sanitizeEmoteKeys, type EmoteKeys } from '../../shared';
import { cachedProfile, isGuest, loadProfileKey, saveProfile } from './profile';

export const EMOTE_KEYS_KEY = 'party-game:emote-keys';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Guests keep their keys for the tab only (like the guest flag itself); everyone else in the browser. */
function storeFor(guest: boolean): Store | undefined {
  try {
    return guest ? sessionStorage : localStorage;
  } catch {
    return undefined;
  }
}

let memory: EmoteKeys | null = null; // page-lifetime copy, used when storage is unavailable
const listeners = new Set<() => void>();

/** Called whenever the emote keys change. */
export function onEmoteKeysChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readStore(store: Store | undefined): EmoteKeys | null {
  try {
    const raw = store?.getItem(EMOTE_KEYS_KEY);
    return raw ? sanitizeEmoteKeys(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Current keys: guests -> this tab's storage; others -> this browser's storage, then the profile cache; else defaults. */
export function loadEmoteKeys(guest: boolean = isGuest()): EmoteKeys {
  if (memory) return memory;
  const fromStore = readStore(storeFor(guest));
  if (fromStore) return fromStore;
  if (!guest) {
    const fromProfile = cachedProfile()?.emoteKeys;
    if (fromProfile) return sanitizeEmoteKeys(fromProfile);
  }
  return defaultEmoteKeys();
}

function remember(k: EmoteKeys, guest: boolean): void {
  memory = k;
  const store = storeFor(guest);
  try {
    if (isDefaultEmoteKeys(k)) store?.removeItem(EMOTE_KEYS_KEY);
    else store?.setItem(EMOTE_KEYS_KEY, JSON.stringify(k));
  } catch {
    /* private mode / quota: the in-memory copy still serves this page */
  }
  listeners.forEach((f) => f());
}

/**
 * Save new keys. Always kept in the browser (the tab only for guests); sent to the profile only for
 * registered players that already have a saved profile (changing a key never creates a server record).
 */
export async function saveEmoteKeys(keys: EmoteKeys, guest: boolean = isGuest()): Promise<EmoteKeys> {
  const clean = sanitizeEmoteKeys(keys);
  remember(clean, guest);
  if (!guest && cachedProfile()) {
    try {
      const rec = await saveProfile(loadProfileKey(), { emoteKeys: clean });
      const stored = rec.emoteKeys ? sanitizeEmoteKeys(rec.emoteKeys) : defaultEmoteKeys();
      remember(stored, guest);
      return stored;
    } catch {
      /* offline: the local copy is already saved */
    }
  }
  return clean;
}

/** Adopt the keys saved in a profile fetched from the server (no-op when it has none). */
export function adoptProfileEmoteKeys(rec: { emoteKeys?: unknown } | null): void {
  if (isGuest() || !rec?.emoteKeys) return;
  remember(sanitizeEmoteKeys(rec.emoteKeys), false);
}

/** Test hook: forget the page-lifetime copy. */
export function _resetEmoteKeysMemory(): void {
  memory = null;
}
