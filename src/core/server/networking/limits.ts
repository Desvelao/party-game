import { createHash, timingSafeEqual } from 'node:crypto';
/** Per-IP concurrent connection counter. A limit of 0 means unlimited. */
export class ConnectionCounter {
  private counts = new Map<string, number>();

  constructor(public limit: number) {}

  /** Returns false (and counts nothing) when `ip` is at its limit. */
  acquire(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (this.limit > 0 && n >= this.limit) return false;
    this.counts.set(ip, n + 1);
    return true;
  }

  release(ip: string): void {
    const n = this.counts.get(ip) ?? 0;
    if (n <= 1) this.counts.delete(ip);
    else this.counts.set(ip, n - 1);
  }
}

export { FixedWindowLimiter, apiLimiter } from '../../shared/kit/ratelimit';

/**
 * Peer address, or the LAST X-Forwarded-For entry when behind a trusted proxy. A proxy appends the
 * address it saw, so earlier entries are client-supplied and must not be trusted.
 */
export function clientIp(
  remote: string | undefined,
  forwarded: string | string[] | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwarded) {
    const joined = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const last = joined.split(',').at(-1)?.trim();
    if (last) return last;
  }
  return remote ?? 'unknown';
}

export const isLoopback = (ip: string) =>
  ip === '::1' || ip === 'localhost' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.');

/**
 * May this caller reset the shared stats window? With a token configured the caller must present
 * it (constant-time compare); without one only loopback callers may, and not through a proxy: a request that
 * carries X-Forwarded-For (`proxied`) comes from a reverse proxy on the same host, so its caller is not local.
 */
export function statsResetAllowed(token: string, provided: string | undefined, ip: string, proxied = false): boolean {
  if (!token) return isLoopback(ip) && !proxied;
  return tokenMatches(token, provided);
}

/** Keep a per-IP failure table bounded by dropping its oldest entries (insertion order), never all of them at once. */
export function trimOldest(map: Map<string, unknown>, max: number): void {
  for (const key of map.keys()) {
    if (map.size <= max) return;
    map.delete(key);
  }
}

/** Constant-time comparison of a presented secret against the configured one. */
export function tokenMatches(token: string, provided: string | undefined): boolean {
  if (!token || provided === undefined) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

/** General (non-INPUT) message budget: JOIN/READY/VOTE/PING etc. */
export const BUCKET_CAPACITY = 90;
export const BUCKET_REFILL_PER_SEC = 60;
/** INPUT has its own budget so a 60Hz sender is never throttled by it. */
export const INPUT_BUCKET_CAPACITY = 120;
export const INPUT_BUCKET_REFILL_PER_SEC = 90;
/** Close the socket once this many strikes are held at once. */
export const MAX_STRIKES = 50;
/** Strikes drain at this rate while the client behaves. */
export const STRIKE_DECAY_PER_SEC = 0.5;

/** The budget a raw frame is charged to, decided without parsing it: every client writes INPUT with `t` first. */
export function messageKind(raw: string): 'input' | 'other' {
  return raw.startsWith('{"t":"INPUT"') ? 'input' : 'other';
}

class Bucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Per-connection inbound limiter: two token buckets plus a leaky strike counter. */
export class MessageGovernor {
  private readonly general: Bucket;
  private readonly input: Bucket;
  private strikes = 0;
  private strikesAt: number;

  constructor(private readonly clock: () => number = Date.now) {
    const now = clock();
    this.general = new Bucket(BUCKET_CAPACITY, BUCKET_REFILL_PER_SEC, now);
    this.input = new Bucket(INPUT_BUCKET_CAPACITY, INPUT_BUCKET_REFILL_PER_SEC, now);
    this.strikesAt = now;
  }

  /** False when this message exceeds its budget. */
  allow(kind: 'input' | 'other'): boolean {
    return (kind === 'input' ? this.input : this.general).take(this.clock());
  }

  /** Records a violation; true once the client should be disconnected. */
  strike(): boolean {
    const now = this.clock();
    this.strikes = Math.max(0, this.strikes - ((now - this.strikesAt) / 1000) * STRIKE_DECAY_PER_SEC);
    this.strikesAt = now;
    return ++this.strikes > MAX_STRIKES;
  }
}
