/** Connection quality from the round-trip time of the last ping. */
export type NetQuality = 'unknown' | 'good' | 'fair' | 'weak' | 'poor';

/** Round-trip limits (ms) between the levels. */
export const QUALITY_LIMITS = { good: 80, fair: 150, weak: 300 } as const;

export function qualityOf(rttMs: number): NetQuality {
  if (!(rttMs > 0)) return 'unknown';
  if (rttMs < QUALITY_LIMITS.good) return 'good';
  if (rttMs < QUALITY_LIMITS.fair) return 'fair';
  if (rttMs < QUALITY_LIMITS.weak) return 'weak';
  return 'poor';
}

/** Signal bars lit (0..4) for a quality. */
export function barsOf(q: NetQuality): number {
  return q === 'good' ? 4 : q === 'fair' ? 3 : q === 'weak' ? 2 : q === 'poor' ? 1 : 0;
}

/**
 * Tracks consecutive samples to decide when to warn: after `after` poor samples in a row, at most once
 * per `cooldownMs`. Pure so it can be tested without timers.
 */
export class PoorConnectionWatch {
  private streak = 0;
  private lastWarnAt = -Infinity;

  constructor(
    private readonly after = 90, // ~3 s of samples at the ~30 Hz pump
    private readonly cooldownMs = 60_000,
  ) {}

  /** True when the player should be told the connection is poor. */
  sample(q: NetQuality, nowMs: number): boolean {
    if (q !== 'poor') {
      this.streak = 0;
      return false;
    }
    if (++this.streak < this.after || nowMs - this.lastWarnAt < this.cooldownMs) return false;
    this.lastWarnAt = nowMs;
    return true;
  }
}
