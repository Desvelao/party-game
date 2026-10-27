// Per-key rate limiting shared by the core and the plugins (a plugin may import `core/shared/kit` helpers).

/**
 * Per-key fixed-window limiter with bounded memory. Entries are kept in window-start order, so when
 * the map exceeds `maxKeys` expired windows are dropped first, then the oldest ones, never all.
 */
export class FixedWindowLimiter {
  private hits = new Map<string, { n: number; reset: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  /** False once `key` has used its budget for the current window. */
  allow(key: string, now: number = Date.now()): boolean {
    const h = this.hits.get(key);
    if (h && h.reset > now) return ++h.n <= this.limit;
    // re-insert so the map stays ordered by window start
    this.hits.delete(key);
    this.hits.set(key, { n: 1, reset: now + this.windowMs });
    if (this.hits.size > this.maxKeys) this.evict(now);
    return true;
  }

  private evict(now: number): void {
    for (const [k, v] of this.hits) {
      if (v.reset > now) break;
      this.hits.delete(k);
    }
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(k);
    }
  }

  get size(): number {
    return this.hits.size;
  }

  /** forget every counter */
  clear(): void {
    this.hits.clear();
  }
}

/** The per-address budget of the HTTP APIs (the core's profile API and the plugins' routes): 60 calls a minute, 5000 addresses. */
export const apiLimiter = (): FixedWindowLimiter => new FixedWindowLimiter(60, 60_000, 5000);
