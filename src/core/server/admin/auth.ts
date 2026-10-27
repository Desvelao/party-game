import type { IncomingMessage } from 'node:http';
import type { ServerConfig } from '../config';
import { clientIp, isLoopback, tokenMatches, trimOldest } from '../networking/limits';

export type AuthResult = { ok: true } | { ok: false; status: 401 | 403 | 429; error: string };

/** Failed attempts allowed per IP within `WINDOW_MS` before the admin API answers 429. */
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
/** Addresses whose failures are tracked; past this the oldest are forgotten (never all at once). */
const MAX_TRACKED = 2000;

/**
 * Bearer-token gate for /api/admin/*. The token is `adminToken`.
 * Without one only loopback callers are let in, and never when the request
 * carries X-Forwarded-For (a reverse proxy on the same host would otherwise look like loopback).
 */
export class AdminAuth {
  private failures = new Map<string, { n: number; reset: number }>();

  constructor(
    private readonly cfg: Pick<ServerConfig, 'adminToken' | 'trustProxy'>,
    private readonly clock: () => number = Date.now,
  ) {}

  /** console mode: a paired phone's token also opens the admin API */
  private consoleToken: ((t: string) => boolean) | null = null;

  setConsole(valid: (token: string) => boolean): void {
    this.consoleToken = valid;
  }

  get token(): string {
    return this.cfg.adminToken;
  }

  ip(req: IncomingMessage): string {
    return clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], this.cfg.trustProxy);
  }

  check(req: IncomingMessage): AuthResult {
    const ip = this.ip(req);
    const now = this.clock();
    const f = this.failures.get(ip);

    const token = this.token;
    const auth0 = req.headers.authorization;
    const bearer = auth0?.startsWith('Bearer ') ? auth0.slice(7).trim() : undefined;
    if (bearer && this.consoleToken?.(bearer)) return { ok: true };
    if (!token) {
      const proxied = !!req.headers['x-forwarded-for'];
      if (isLoopback(ip) && !proxied) return { ok: true };
      return { ok: false, status: 403, error: 'admin is loopback-only until ADMIN_TOKEN is set' };
    }
    const auth = req.headers.authorization;
    const provided = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    // a valid credential always gets in: a lockout only stops guessing, so an attacker sharing the operator's IP cannot lock them out
    if (tokenMatches(token, provided)) return { ok: true };

    if (f && f.reset > now && f.n >= MAX_FAILURES) return { ok: false, status: 429, error: 'too many failed attempts' };
    if (!f || f.reset <= now) this.failures.set(ip, { n: 1, reset: now + WINDOW_MS });
    else f.n++;
    trimOldest(this.failures, MAX_TRACKED);
    return { ok: false, status: 401, error: 'missing or invalid admin token' };
  }
}
