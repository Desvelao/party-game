import { PROFILE_KEY_RE, getLang, setLang, type Lang, type ProfilePatch, type ProfileRecord, type ProfileStats } from '../../shared';

export const PROFILE_KEY = 'party-game:profile-key';
const CACHE_KEY = 'party-game:profile';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const GUEST_KEY = 'party-game:guest';

/** Guest mode (per tab): no profile key is created or sent and no profile call is made. */
export function isGuest(): boolean {
  try {
    return sessionStorage.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

export function setGuest(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(GUEST_KEY, '1');
    else sessionStorage.removeItem(GUEST_KEY);
  } catch {
    /* private mode */
  }
}

function defaultStore(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The secret that identifies this player's profile. Created on first use and persisted;
 * when storage is unavailable a per-page key is returned (the profile then lives for the tab only).
 */
export function loadProfileKey(storage: Store | undefined = defaultStore(), make: () => string = randomKey): string {
  try {
    const have = storage?.getItem(PROFILE_KEY);
    if (have && PROFILE_KEY_RE.test(have)) return have;
  } catch {
    /* fall through */
  }
  const key = make();
  try {
    storage?.setItem(PROFILE_KEY, key);
  } catch {
    /* private mode */
  }
  return key;
}

/** Adopt a recovery code from another device. Returns false when it is not a valid code. */
export function adoptProfileKey(raw: string, storage: Store | undefined = defaultStore()): boolean {
  const key = raw.trim().toLowerCase();
  if (!PROFILE_KEY_RE.test(key)) return false;
  try {
    storage?.setItem(PROFILE_KEY, key);
    storage?.setItem(CACHE_KEY, '');
  } catch {
    return false;
  }
  return true;
}

export function winRate(stats: ProfileStats): number {
  return stats.matches > 0 ? Math.round((stats.wins / stats.matches) * 100) : 0;
}

export function cachedProfile(storage: Store | undefined = defaultStore()): ProfileRecord | null {
  try {
    const raw = storage?.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ProfileRecord) : null;
  } catch {
    return null;
  }
}

function cache(rec: ProfileRecord, storage: Store | undefined): void {
  try {
    storage?.setItem(CACHE_KEY, JSON.stringify(rec));
  } catch {
    /* private mode / quota */
  }
}

/** Turns what a pasted string says into a profile key (installed plugins add ways: a one-time code); null when it is not theirs. */
export type RecoveryResolver = (raw: string) => Promise<string | null>;
let resolver: RecoveryResolver = async () => null;
export function setRecoveryResolver(fn: RecoveryResolver): void {
  resolver = fn;
}

/** A profile key, or a recovery link (`#recover=<key>`). Anything else is left to the plugins' resolver. */
export function parseRecoveryInput(raw: string): { key: string } | null {
  let s = raw.trim();
  const m = /#recover=([^&\s]+)/.exec(s);
  if (m) s = m[1];
  const key = s.toLowerCase();
  return PROFILE_KEY_RE.test(key) ? { key } : null;
}

/** Permanent link that adopts this profile key on whichever device opens it (the key stays in the #fragment, never sent to a server). */
export const recoveryLink = (key: string, origin: string = location.origin): string => `${origin}/#recover=${key}`;

/** Adopt a pasted key or link, or whatever a plugin turns it into, on this device. False when it is invalid, unknown or expired. */
export async function applyRecoveryInput(
  raw: string,
  storage: Store | undefined = defaultStore(),
  resolve: RecoveryResolver = (r) => resolver(r),
): Promise<boolean> {
  const input = parseRecoveryInput(raw);
  if (input) return adoptProfileKey(input.key, storage);
  try {
    const key = await resolve(raw);
    return key && PROFILE_KEY_RE.test(key) ? adoptProfileKey(key, storage) : false;
  } catch {
    return false;
  }
}

/** Saved profile, or null when none exists yet. Throws when the server cannot be reached. */
export async function fetchProfile(
  key: string,
  fetchFn: FetchFn = (i, o) => fetch(i, o),
  storage: Store | undefined = defaultStore(),
): Promise<ProfileRecord | null> {
  if (isGuest()) return null;
  const res = await fetchFn('/api/profile', { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
  if (!res.ok) throw new Error(`profile ${res.status}`);
  const body = (await res.json()) as { profile: ProfileRecord | null };
  if (body.profile) cache(body.profile, storage);
  return body.profile;
}

export async function saveProfile(
  key: string,
  patch: ProfilePatch,
  fetchFn: FetchFn = (i, o) => fetch(i, o),
  storage: Store | undefined = defaultStore(),
): Promise<ProfileRecord> {
  if (isGuest()) throw new Error('guest');
  const res = await fetchFn('/api/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`profile ${res.status}`);
  const body = (await res.json()) as { profile: ProfileRecord };
  cache(body.profile, storage);
  return body.profile;
}

/** Adopt the language saved in the profile (no-op when the profile has none). */
export function applyProfileLang(rec: ProfileRecord | null): void {
  if (rec?.lang && rec.lang !== getLang()) setLang(rec.lang as Lang);
}

/**
 * Save a language change into the profile. Only for browsers that already have a saved
 * profile, so just switching language never creates a server record. Fire-and-forget.
 */
export function persistLang(
  lang: Lang,
  fetchFn: FetchFn = (i, o) => fetch(i, o),
  storage: Store | undefined = defaultStore(),
): void {
  const have = cachedProfile(storage);
  if (!have || have.lang === lang) return;
  let key: string | null = null;
  try {
    key = storage?.getItem(PROFILE_KEY) ?? null;
  } catch {
    /* ignore */
  }
  if (!key) return;
  saveProfile(key, { lang }, fetchFn, storage).catch(() => {});
}
