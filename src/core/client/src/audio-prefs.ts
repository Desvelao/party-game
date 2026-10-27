import { defaultAudioPrefs, isDefaultAudioPrefs, sanitizeAudioPrefs, type AudioPrefs } from '../../shared';
import { cachedProfile, isGuest, loadProfileKey, saveProfile } from './profile';

export const AUDIO_PREFS_KEY = 'party-game:audio-prefs';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Guests keep their options for the tab only (like the guest flag itself); everyone else in the browser. */
function storeFor(guest: boolean): Store | undefined {
  try {
    return guest ? sessionStorage : localStorage;
  } catch {
    return undefined;
  }
}

let memory: AudioPrefs | null = null; // page-lifetime copy, used when storage is unavailable
const listeners = new Set<() => void>();

/** Called whenever the volume levels change. */
export function onAudioPrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readStore(store: Store | undefined): AudioPrefs | null {
  try {
    const raw = store?.getItem(AUDIO_PREFS_KEY);
    return raw ? sanitizeAudioPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Current options: guests -> this tab's storage; others -> this browser's storage, then the profile cache; else defaults. */
export function loadAudioPrefs(guest: boolean = isGuest()): AudioPrefs {
  if (memory) return memory;
  const fromStore = readStore(storeFor(guest));
  if (fromStore) return fromStore;
  if (!guest) {
    const fromProfile = cachedProfile()?.audio;
    if (fromProfile) return sanitizeAudioPrefs(fromProfile);
  }
  return defaultAudioPrefs();
}

function remember(k: AudioPrefs, guest: boolean): void {
  memory = k;
  const store = storeFor(guest);
  try {
    if (isDefaultAudioPrefs(k)) store?.removeItem(AUDIO_PREFS_KEY);
    else store?.setItem(AUDIO_PREFS_KEY, JSON.stringify(k));
  } catch {
    /* private mode / quota: the in-memory copy still serves this page */
  }
  listeners.forEach((f) => f());
}

/**
 * Save new options. Always kept in the browser (the tab only for guests); sent to the profile only for
 * registered players that already have a saved profile (changing a key never creates a server record).
 */
export async function saveAudioPrefs(keys: AudioPrefs, guest: boolean = isGuest()): Promise<AudioPrefs> {
  const clean = sanitizeAudioPrefs(keys);
  remember(clean, guest);
  if (!guest && cachedProfile()) {
    try {
      const rec = await saveProfile(loadProfileKey(), { audio: clean });
      const stored = rec.audio ? sanitizeAudioPrefs(rec.audio) : defaultAudioPrefs();
      remember(stored, guest);
      return stored;
    } catch {
      /* offline: the local copy is already saved */
    }
  }
  return clean;
}

/** Adopt the options saved in a profile fetched from the server (no-op when it has none). */
export function adoptProfileAudioPrefs(rec: { audio?: unknown } | null): void {
  if (isGuest() || !rec?.audio) return;
  remember(sanitizeAudioPrefs(rec.audio), false);
}

/** Test hook: forget the page-lifetime copy. */
export function _resetAudioPrefsMemory(): void {
  memory = null;
}
