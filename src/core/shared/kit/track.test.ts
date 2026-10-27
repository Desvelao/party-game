import { describe, expect, it } from 'vitest';
import { EntityTracker, type Advance } from './track';

describe('EntityTracker', () => {
  it('knows nothing on the first sight, then takes the finite difference', () => {
    const tr = new EntityTracker();
    const first = tr.observe(1, 0, 0, 0);
    expect(first).toMatchObject({ known: false, vx: 0, vy: 0 });
    const second = tr.observe(1, 10, -5, 0.5);
    expect(second).toMatchObject({ known: true, vx: 20, vy: -10 });
    expect(tr.fallback).toBe(1);
    expect(tr.corrected).toBe(0);
  });

  it('ignores a repeated timestamp', () => {
    const tr = new EntityTracker();
    tr.observe('a', 0, 0, 1);
    tr.observe('a', 4, 0, 2);
    const same = tr.observe('a', 99, 99, 2);
    expect(same).toMatchObject({ x: 4, y: 0, vx: 4 });
  });

  it('prefers the simulated velocity when the simulation lands on the observation (a bounce between snapshots)', () => {
    // a ball going right at 10 px/s that bounces off a wall at x = 10
    const advance: Advance = (p, dt) => {
      let x = p.x + p.vx * dt;
      let vx = p.vx;
      if (x > 10) {
        x = 20 - x;
        vx = -vx;
      }
      return { x, y: p.y, vx, vy: p.vy };
    };
    const tr = new EntityTracker();
    tr.observe(1, 8, 0, 0);
    tr.observe(1, 9, 0, 0.1, advance); // no velocity known yet: finite difference, 10 px/s
    const t = tr.observe(1, 9, 0, 0.3, advance); // went to 10, bounced and came back to 9
    expect(t.vx).toBe(-10);
    expect(tr.corrected).toBe(1);
  });

  it('falls back to the difference when the simulation misses by more than the tolerance', () => {
    const wrong: Advance = (p) => ({ x: p.x + 1000, y: p.y, vx: 5, vy: 0 });
    const tr = new EntityTracker(4);
    tr.observe(1, 0, 0, 0);
    tr.observe(1, 1, 0, 1);
    const t = tr.observe(1, 3, 0, 2, wrong);
    expect(t.vx).toBe(2);
    expect(tr.corrected).toBe(0);
  });

  it('reset and prune forget entities', () => {
    const tr = new EntityTracker();
    tr.observe(1, 0, 0, 0);
    tr.observe(2, 0, 0, 0);
    tr.observe(3, 0, 0, 0);
    tr.reset(1);
    tr.prune(new Set([2]));
    expect(tr.observe(1, 5, 5, 1).known).toBe(false);
    expect(tr.observe(3, 5, 5, 1).known).toBe(false);
    expect(tr.observe(2, 5, 5, 1).known).toBe(true);
  });
});
