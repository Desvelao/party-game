import type { RawPlacement } from '../plugin-api';

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const pick = <T>(a: readonly T[], rng: () => number = Math.random): T => a[Math.floor(rng() * a.length)];

/**
 * Seconds until the next timed event: `every` +- `variance` (uniform), never less than `minGap`.
 * Every "X every" option pairs with an "X variance" option read through this.
 * With no variance it is exactly `every` and does not consume the rng (seeded rounds stay reproducible).
 */
export const nextIn = (rng: () => number, every: number, variance: number, minGap = 0.5): number =>
  variance > 0 ? Math.max(minGap, every + (rng() * 2 - 1) * variance) : every;

/** Small seeded PRNG so rounds are reproducible in tests and in the balance tool. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 0..1 ease; input is clamped to [0, 1]. */
export const smoothstep = (x: number) => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};

/**
 * Shared last-standing bookkeeping. Games stamp `elimOrder = this.t` when a
 * player is eliminated; simultaneous eliminations share a key and tie.
 */
export class LastStandingTracker {
  constructor(private readonly initialCount: number) {}

  /** Round is decided: one (or none) left, or nobody left in a solo game. */
  isOver(alive: number): boolean {
    return this.initialCount > 1 ? alive <= 1 : alive === 0;
  }

  /**
   * Competition-rank the eliminated: later elimination = better place, equal
   * keys tie. The best eliminated player gets `firstPlace`.
   */
  rankEliminated(
    dead: readonly { id: string; elimOrder: number }[],
    firstPlace: number,
  ): RawPlacement[] {
    const sorted = [...dead].sort((a, b) => b.elimOrder - a.elimOrder);
    let place = 0;
    return sorted.map((p, i) => {
      if (i === 0 || p.elimOrder !== sorted[i - 1].elimOrder) place = firstPlace + i;
      return { id: p.id, place };
    });
  }
}
