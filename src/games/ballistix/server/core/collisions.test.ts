import { describe, expect, it } from 'vitest';
import { createBallArena } from '../variants';
import type { BallArena } from './BallArena';
import { VARIANTS, applyOptions } from '../variants';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const crash = VARIANTS.find((v) => v.id === 'smashball')!;
type B = { x: number; y: number; vx: number; vy: number; wait: number; corner: number; boost: number; px: number; py: number; held: boolean };
const raw = (g: BallArena) => (g as unknown as { balls: B[] }).balls;

/** Arena with exactly the given balls in flight, no minimum speed so physics is exact. */
function arena(balls: Partial<B>[], cfg = { ...crash, ballMinSpeed: 1 }) {
  const g = createBallArena({ ...cfg, startBalls: () => balls.length }, 1);
  g.init(players(2));
  raw(g).forEach((b, i) => Object.assign(b, { wait: 0, corner: -1, px: balls[i].x, py: balls[i].y }, balls[i]));
  return g;
}
const tick = (g: BallArena, n = 1) => {
  for (let i = 0; i < n; i++) g.update(1 / 60);
};

describe('ball-ball collisions', () => {
  it('head-on balls bounce back at the same speed', () => {
    const g = arena([
      { x: 400, y: 500, vx: 400, vy: 0 },
      { x: 470, y: 500, vx: -400, vy: 0 },
    ]);
    tick(g, 10);
    const [a, b] = raw(g);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(Math.abs(a.vx)).toBeCloseTo(400, 0);
    expect(Math.abs(b.vx)).toBeCloseTo(400, 0);
  });

  it('a glancing hit conserves momentum and kinetic energy', () => {
    const g = arena([
      { x: 400, y: 500, vx: 500, vy: 0 },
      { x: 460, y: 520, vx: -100, vy: 0 },
    ]);
    const before = raw(g).map((b) => ({ vx: b.vx, vy: b.vy }));
    tick(g, 8);
    const after = raw(g);
    const sum = (xs: { vx: number; vy: number }[], k: 'vx' | 'vy') => xs.reduce((s, b) => s + b[k], 0);
    expect(sum(after, 'vx')).toBeCloseTo(sum(before, 'vx'), 3);
    expect(sum(after, 'vy')).toBeCloseTo(sum(before, 'vy'), 3);
    const ke = (xs: { vx: number; vy: number }[]) => xs.reduce((s, b) => s + b.vx * b.vx + b.vy * b.vy, 0);
    expect(ke(after)).toBeCloseTo(ke(before), 0);
    // it really was a deflection: the struck ball picked up sideways speed
    expect(Math.abs(after[1].vy)).toBeGreaterThan(50);
  });

  it('a stationary ball is set in motion', () => {
    const g = arena([
      { x: 400, y: 500, vx: 400, vy: 0 },
      { x: 450, y: 500, vx: 0, vy: 0 },
    ]);
    tick(g, 6);
    const [a, b] = raw(g);
    expect(b.vx).toBeGreaterThan(300);
    expect(Math.abs(a.vx)).toBeLessThan(50);
  });

  it('fast boosted balls cannot tunnel through each other', () => {
    const g = arena([
      { x: 470, y: 500, vx: 1300, vy: 0, boost: 1 },
      { x: 510, y: 500, vx: -1300, vy: 0, boost: 1 },
    ]);
    tick(g, 1);
    const [a, b] = raw(g);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.x).toBeLessThan(b.x);
  });

  it('balls charging in a corner do not collide', () => {
    const g = createBallArena({ ...crash, startBalls: () => 2, spawn: { delay: 50, variance: 0 } }, 1);
    g.init(players(2));
    const bs = raw(g);
    Object.assign(bs[0], { x: 500, y: 500, px: 500, py: 500, wait: 40 });
    Object.assign(bs[1], { x: 500, y: 500, px: 500, py: 500, vx: 300, vy: 0, wait: 0, corner: -1 });
    tick(g, 3);
    expect(bs[1].vx).toBeCloseTo(300, 0); // unaffected by the parked ball
    expect(bs[0].wait).toBeGreaterThan(0);
  });

  it('ballCollisions=false lets balls pass through', () => {
    const cfg = applyOptions(crash, { ballCollisions: false });
    const g = arena(
      [
        { x: 400, y: 500, vx: 400, vy: 0 },
        { x: 470, y: 500, vx: -400, vy: 0 },
      ],
      { ...cfg, ballMinSpeed: 1 },
    );
    tick(g, 10);
    const [a, b] = raw(g);
    expect(a.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(0);
  });

  it('a held ball is an immovable obstacle', () => {
    const g = arena([
      { x: 500, y: 500, vx: 0, vy: 0, held: true },
      { x: 440, y: 500, vx: 400, vy: 0 },
    ]);
    tick(g, 12);
    const [h, f] = raw(g);
    expect(h.x).toBe(500);
    expect(f.vx).toBeLessThan(0);
  });
});

describe.each(VARIANTS.map((v) => v.id))('%s: balls never stay overlapped', (id) => {
  it('4 balls for 40 s', () => {
    const v = VARIANTS.find((x) => x.id === id)!;
    const g = createBallArena({ ...v, startBalls: () => 4, spawn: { delay: 1, variance: 0.3 } }, 5);
    g.init(players(4));
    const D = 2 * v.ballRadius;
    let worst = 0;
    for (let i = 0; i < 60 * 40; i++) {
      for (const p of g.getState().paddles) g.handleInput(p.id, { mx: Math.sin(i / 23 + p.side), my: 0, a1: i % 70 === 0, a2: false });
      g.update(1 / 60);
      const flying = raw(g).filter((b) => b.wait <= 0 && !b.held);
      for (let a = 0; a < flying.length; a++)
        for (let b = a + 1; b < flying.length; b++) {
          const d = Math.hypot(flying[a].x - flying[b].x, flying[a].y - flying[b].y);
          worst = Math.max(worst, D - d);
        }
      if (g.isFinished()) break;
    }
    // transient overlap while walls/paddles squeeze a pair is fine, deep overlap is not
    expect(worst).toBeLessThan(v.ballRadius * 0.9);
  });
});

describe('quarter-disc corners', () => {
  it('a ball hitting the arc along the diagonal reflects straight back, resting outside it', async () => {
    const { bounceCorner } = await import('./physics');
    const { CORNER_SIZE, fieldCorner } = await import('../../shared/geometry');
    const [cx, cy] = fieldCorner(2);
    const r = 18;
    const d = CORNER_SIZE + r - 1; // 1 px into the arc
    const k = d / Math.SQRT2;
    const b: any = { x: cx - k, y: cy - k, vx: 300, vy: 300 };
    bounceCorner(b, 2, r);
    expect(Math.hypot(b.x - cx, b.y - cy)).toBeCloseTo(CORNER_SIZE + r, 3);
    expect(b.vx).toBeCloseTo(-300, 3);
    expect(b.vy).toBeCloseTo(-300, 3);
  });

  it('a ball skimming along the edge is deflected tangentially and a distant ball is untouched', async () => {
    const { bounceCorner } = await import('./physics');
    const { CORNER_SIZE, fieldCorner } = await import('../../shared/geometry');
    const [cx, cy] = fieldCorner(0);
    const r = 18;
    const near: any = { x: cx + CORNER_SIZE + r - 4, y: cy + 10, vx: -200, vy: 0 };
    bounceCorner(near, 0, r);
    expect(Math.hypot(near.x - cx, near.y - cy)).toBeGreaterThanOrEqual(CORNER_SIZE + r - 1e-6);
    expect(near.vx).toBeGreaterThan(0);
    const far: any = { x: cx + 200, y: cy + 200, vx: -100, vy: -100 };
    bounceCorner(far, 0, r);
    expect(far).toEqual({ x: cx + 200, y: cy + 200, vx: -100, vy: -100 });
  });
});
