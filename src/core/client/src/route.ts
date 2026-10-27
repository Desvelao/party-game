import { normalizeRoomCode, sanitizePassword } from '../../shared';

/**
 * URL scheme: the path names the view, the query only modifies an action on it.
 *   /                      main menu
 *   /profile               profile
 *   /tv                    console mode: the TV screen that owns a room (the Pi kiosk)
 *   /console               console mode: pair this phone with the TV and host
 *   /room/ABCD             join room ABCD
 *   /room/ABCD?spectate=1  watch room ABCD
 *   /room/ABCD?password=x  join a password-protected room (combine with spectate=1 to watch)
 * Old links (`/?view=profile`, `/?room=ABCD[&spectate=1]`) are still understood.
 */
export type Route = { view: 'menu' } | { view: 'profile' } | { view: 'tv' } | { view: 'console' } | { view: 'room'; code: string; spectate: boolean; password?: string };

export function parseLocation(pathname: string, search: string): Route {
  const q = new URLSearchParams(search);
  const spectate = q.get('spectate') === '1';
  const m = /^\/room\/([^/]+)\/?$/.exec(pathname);
  const code = normalizeRoomCode(m ? decodeURIComponent(m[1]!) : q.get('room'));
  const password = sanitizePassword(q.get('password')) ?? undefined;
  if (code) return { view: 'room', code, spectate, ...(password ? { password } : {}) };
  const flat = pathname.replace(/\/$/, '');
  if (flat === '/tv') return { view: 'tv' };
  if (flat === '/console') return { view: 'console' };
  if (pathname.replace(/\/$/, '') === '/profile' || q.get('view') === 'profile') return { view: 'profile' };
  return { view: 'menu' };
}

export const profilePath = (): string => '/profile';

export function roomPath(code: string, spectate = false, password?: string | null): string {
  const q = new URLSearchParams();
  if (spectate) q.set('spectate', '1');
  if (password) q.set('password', password);
  const qs = q.toString();
  return `/room/${code}${qs ? `?${qs}` : ''}`;
}

/** Change the address bar without adding a history entry (no-op where history is unavailable). */
export function replacePath(path: string): void {
  try {
    if (location.pathname + location.search !== path) history.replaceState(null, '', path);
  } catch {
    /* sandboxed iframe etc. */
  }
}
