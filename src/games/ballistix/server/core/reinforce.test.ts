import { describe, expect, it } from 'vitest';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../../core/shared/catalog';
import { createBallArena } from '../variants';
import type { BallArena } from './BallArena';
import { VARIANTS, applyOptions } from '../variants';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const crash = VARIANTS.find((v) => v.id === 'smashball')!;
const beach = VARIANTS.find((v) => v.id === 'sand-orb')!;

/** Count balls over time with all paddles idle-tracking so the round survives. */
function ballCountAt(opts: Record<string, number | boolean | string>, seconds: number, base = crash) {
  const cfg = applyOptions(base, { lives: 15, timeLimit: 300, ...opts });
  const g = createBallArena(cfg, 3);
  g.init(players(4));
  const counts: number[] = [];
  for (let i = 0; i < seconds * 60 && !g.isFinished(); i++) {
    g.update(1 / 60);
    if (i % 60 === 59) counts.push(g.getState().balls.length);
  }
  return counts;
}

describe('reinforcement balls', () => {
  it('every variant defines them', () => {
    for (const v of VARIANTS) {
      expect(v.reinforce.every).toBeGreaterThan(0);
      expect(v.reinforce.max).toBeGreaterThanOrEqual(0);
    }
  });

  it('adds balls over time and stops at the maximum', () => {
    const c = ballCountAt({ balls: '1', ballSpawnEvery: 5, maxBalls: 3, spawnDelayVariance: 0, ballSpawnVariance: 0 }, 60);
    expect(c[0]).toBe(1);
    expect(Math.max(...c)).toBe(3);
    // monotonic, never above the cap
    c.forEach((n, i) => i > 0 && expect(n).toBeGreaterThanOrEqual(c[i - 1]));
    expect(c.at(-1)).toBe(3);
  });

  it('no maximum keeps adding balls', () => {
    const c = ballCountAt({ balls: '1', ballSpawnEvery: 3, maxBalls: 0, spawnDelayVariance: 0, ballSpawnVariance: 0 }, 60);
    expect(c.at(-1)!).toBeGreaterThan(8);
    expect(c.at(-1)!).toBeGreaterThan(4);
  });

  it('start balls above the cap never spawn more', () => {
    const c = ballCountAt({ balls: '3', ballSpawnEvery: 3, maxBalls: 2 }, 30);
    expect(new Set(c)).toEqual(new Set([3]));
  });

  it('the interval is randomized, not fixed', () => {
    const cfg = applyOptions(crash, { balls: '1', ballSpawnEvery: 4, maxBalls: 0, spawnDelayVariance: 2, ballSpawnVariance: 2.4, timeLimit: 300, lives: 15 });
    const g = createBallArena(cfg, 11);
    g.init(players(2));
    const times: number[] = [];
    let last = 1;
    for (let i = 0; i < 60 * 80; i++) {
      g.update(1 / 60);
      const n = g.getState().balls.length;
      if (n > last) times.push(i / 60);
      last = n;
    }
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(gaps.length).toBeGreaterThan(5);
    expect(new Set(gaps.map((x) => x.toFixed(1))).size).toBeGreaterThan(2);
    gaps.forEach((x) => expect(x).toBeGreaterThanOrEqual(4 * 0.4 - 0.1));
  });

  it('works in the other variants through the core logic', () => {
    for (const id of ['pulse-ball', 'cloud-orbs']) {
      const v = VARIANTS.find((x) => x.id === id)!;
      const c = ballCountAt({}, 50, v);
      expect(c.at(-1)!).toBeGreaterThan(c[0]);
    }
  });

  it('options: catalog defaults match config, 0 means unlimited', () => {
    for (const [variant, cfg] of [['smashball', crash], ['sand-orb', beach]] as const) {
      const d = defaultOptions(optionsFor('ballistix', variant));
      expect(d.ballSpawnEvery).toBe(cfg.reinforce.every);
      expect(d.maxBalls).toBe(cfg.reinforce.max);
    }
    const sel = normalizeSelection('ballistix', 'smashball', { maxBalls: 0, ballSpawnEvery: 99 })!;
    expect(sel.options).toEqual({ maxBalls: 0, ballSpawnEvery: 60 });
    expect(applyOptions(crash, sel.options).reinforce.max).toBe(0);
  });
});
