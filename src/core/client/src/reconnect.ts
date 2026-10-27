/** DOM-free pieces of the reconnect/resume flow (see main.ts for the wiring). */

export interface ResumeInfo {
  code: string;
  /** empty for a spectator (a watcher has no seat to re-attach to; it just joins the room again) */
  token: string;
  name: string;
  spectate?: boolean;
}

export const RESUME_KEY = 'bonk.resume';
/** Client-side cap, a bit above the server's default 60 s grace period. */
export const RECONNECT_MAX_MS = 60_000;
export const RECONNECT_MAX_ATTEMPTS = 12;
const BACKOFF_MS = [500, 1000, 2000, 4000, 5000];

type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): StoreLike | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export function saveResume(info: ResumeInfo, store: StoreLike | null = defaultStore()): void {
  try {
    store?.setItem(RESUME_KEY, JSON.stringify(info));
  } catch {
    /* storage unavailable: resume simply is not offered */
  }
}

export function loadResume(store: StoreLike | null = defaultStore()): ResumeInfo | null {
  try {
    const v = JSON.parse(store?.getItem(RESUME_KEY) ?? 'null');
    if (v && typeof v.code === 'string' && typeof v.token === 'string' && typeof v.name === 'string' && v.code) {
      if (v.spectate === true) return { code: v.code, token: '', name: v.name, spectate: true };
      if (v.token) return { code: v.code, token: v.token, name: v.name };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearResume(store: StoreLike | null = defaultStore()): void {
  try {
    store?.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
}

/** The last room joined as a player: survives closing the tab (the resume token does not). */
export const LAST_ROOM_KEY = 'bonk.lastRoom';
export interface LastRoom {
  code: string;
  name: string;
}

function persistentStore(): StoreLike | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function saveLastRoom(room: LastRoom, store: StoreLike | null = persistentStore()): void {
  try {
    store?.setItem(LAST_ROOM_KEY, JSON.stringify(room));
  } catch {
    /* storage unavailable: the shortcut is simply not offered */
  }
}

export function loadLastRoom(store: StoreLike | null = persistentStore()): LastRoom | null {
  try {
    const v = JSON.parse(store?.getItem(LAST_ROOM_KEY) ?? 'null');
    if (v && typeof v.code === 'string' && typeof v.name === 'string' && v.code) return { code: v.code, name: v.name };
  } catch {
    /* ignore */
  }
  return null;
}

export function clearLastRoom(store: StoreLike | null = persistentStore()): void {
  try {
    store?.removeItem(LAST_ROOM_KEY);
  } catch {
    /* ignore */
  }
}

/** Delay before attempt number `attempt` (0-based): 0.5, 1, 2, 4, 5, 5 ... seconds. */
export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(0, attempt), BACKOFF_MS.length - 1)];
}

/** Stop retrying after too many attempts or too much time. */
export function shouldGiveUp(attempt: number, elapsedMs: number, maxAttempts = RECONNECT_MAX_ATTEMPTS): boolean {
  return attempt >= maxAttempts || elapsedMs >= RECONNECT_MAX_MS;
}

/** Whether a page that opened `/room/<ID>` should try to resume before showing the join-link panel. */
export function startupResume(stored: ResumeInfo | null, urlCode: string | null | undefined, spectateLink: boolean): ResumeInfo | null {
  return stored && !stored.spectate && !spectateLink && urlCode && stored.code === urlCode ? stored : null;
}

export type ResumeErrorAction = 'menu' | 'spectate' | 'give-up';

/** What to do with a server ERROR received while a resume attempt is in flight. */
export function resumeErrorAction(code: string, startup: boolean): ResumeErrorAction {
  if (startup) return 'give-up'; // fall back to the join-link panel
  if (code === 'ROOM_BUSY' || code === 'ROOM_FULL') return 'spectate';
  return 'menu';
}
