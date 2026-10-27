import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from './config';
import { clientIp, isLoopback, tokenMatches, trimOldest } from './networking/limits';

/** Wrong PINs allowed per IP within `WINDOW_MS` before pairing answers 429. */
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
/** Addresses whose failures are tracked; past this the oldest are forgotten (never all at once). */
const MAX_TRACKED = 2000;
/** Wrong PINs from any address before the PIN is replaced, so rotating sources cannot keep guessing one PIN. */
const ROTATE_AFTER = 30;
/** Phones paired at once; the oldest is dropped past this. */
const MAX_TOKENS = 16;

export type PairResult = { ok: true; token: string } | { ok: false; status: 401 | 429; error: string };

/**
 * Console mode: a TV (the Pi's kiosk browser) owns a room and shows a PIN; a phone that types the PIN gets a console
 * token, which makes it the room's controller (host without a seat) and lets it use the admin API.
 * All state lives in memory: a restart asks the phones to pair again.
 */
export class ConsoleManager {
  private current = '';
  private tokens: string[] = [];
  private failures = new Map<string, { n: number; reset: number }>();
  /** wrong PINs against the current PIN, from every address */
  private wrong = 0;
  /** code of the room the TV owns ('' = none yet) */
  roomCode = '';

  constructor(private readonly clock: () => number = Date.now) {
    this.newPin();
  }

  get pin(): string {
    return this.current;
  }

  get paired(): number {
    return this.tokens.length;
  }

  /** A fresh PIN; phones already paired keep working. */
  newPin(): string {
    this.current = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.wrong = 0;
    return this.current;
  }

  pair(ip: string, pin: unknown): PairResult {
    const now = this.clock();
    const f = this.failures.get(ip);
    if (f && f.reset > now && f.n >= MAX_FAILURES) return { ok: false, status: 429, error: 'too many failed attempts' };
    if (typeof pin === 'string' && tokenMatches(this.current, pin.trim())) {
      const token = randomBytes(24).toString('hex');
      this.tokens.push(token);
      if (this.tokens.length > MAX_TOKENS) this.tokens.shift();
      return { ok: true, token };
    }
    if (!f || f.reset <= now) this.failures.set(ip, { n: 1, reset: now + WINDOW_MS });
    else f.n++;
    trimOldest(this.failures, MAX_TRACKED);
    if (++this.wrong >= ROTATE_AFTER) this.newPin();
    return { ok: false, status: 401, error: 'wrong PIN' };
  }

  validToken(token: unknown): boolean {
    if (typeof token !== 'string' || token === '') return false;
    let ok = false;
    for (const t of this.tokens) if (tokenMatches(t, token)) ok = true;
    return ok;
  }

  /** Forget every paired phone. Returns how many there were. */
  unpairAll(): number {
    const n = this.tokens.length;
    this.tokens = [];
    return n;
  }
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/**
 * Public console endpoints (only mounted in console mode):
 * `POST /api/console/pair {pin}` -> `{token, code}` for a phone (409 while no TV screen is connected), `GET /api/console/screen` -> `{pin, code}` for the TV (loopback only).
 */
export function handleConsoleHttp(mgr: ConsoleManager, cfg: Pick<ServerConfig, 'trustProxy' | 'consoleScreenAny'>, req: IncomingMessage, res: ServerResponse, pathname: string, screenUp: () => boolean): boolean {
  const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], cfg.trustProxy);
  if (pathname === '/api/console/screen') {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' }), true;
    if (!cfg.consoleScreenAny && (!isLoopback(ip) || req.headers['x-forwarded-for'])) return json(res, 403, { error: 'only the screen itself may ask' }), true;
    json(res, 200, { pin: mgr.pin, code: mgr.roomCode });
    return true;
  }
  if (pathname === '/api/console/pair') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' }), true;
    // nothing to pair with (and no PIN to guess at) until a TV screen is open
    if (!screenUp()) return json(res, 409, { error: 'no TV is connected' }), true;
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1024) return void req.destroy();
      chunks.push(c);
    });
    req.on('end', () => {
      let pin: unknown;
      try {
        pin = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.pin;
      } catch {
        return json(res, 400, { error: 'invalid json' });
      }
      const r = mgr.pair(ip, pin);
      if (!r.ok) return json(res, r.status, { error: r.error });
      json(res, 200, { token: r.token, code: mgr.roomCode });
    });
    return true;
  }
  return false;
}
