/** Console mode, phone side: pair with the TV's PIN and remember the token. */

const KEY = 'pg-console-token';

export const consoleToken = {
  get(): string {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* private window: the phone pairs again next time */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing stored */
    }
  },
};

export type PairOutcome = { ok: true; token: string } | { ok: false; reason: 'wrong' | 'many' | 'notv' | 'off' | 'net' };

export async function pairConsole(pin: string, fetcher: typeof fetch = fetch): Promise<PairOutcome> {
  try {
    const res = await fetcher('/api/console/pair', { method: 'POST', body: JSON.stringify({ pin }), headers: { 'Content-Type': 'application/json' } });
    if (res.ok) return { ok: true, token: ((await res.json()) as { token: string }).token };
    return { ok: false, reason: res.status === 401 ? 'wrong' : res.status === 429 ? 'many' : res.status === 409 ? 'notv' : 'off' };
  } catch {
    return { ok: false, reason: 'net' };
  }
}

export type ConsoleStatus = { state: 'ok'; roomCode: string } | { state: 'unpaired' } | { state: 'off' } | { state: 'net' };

/** What the server says to a stored token: still good (and the TV's room code), revoked, or console mode is off. */
export async function consoleStatus(token: string, fetcher: typeof fetch = fetch): Promise<ConsoleStatus> {
  try {
    const res = await fetcher('/api/admin/console', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (res.ok) return { state: 'ok', roomCode: ((await res.json()) as { roomCode?: string }).roomCode ?? '' };
    return { state: res.status === 404 ? 'off' : 'unpaired' };
  } catch {
    return { state: 'net' };
  }
}

/** The PIN and room the TV shows (answers only on the TV itself). */
export async function screenInfo(fetcher: typeof fetch = fetch): Promise<{ pin: string; code: string } | null> {
  try {
    const res = await fetcher('/api/console/screen', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as { pin: string; code: string }) : null;
  } catch {
    return null;
  }
}
