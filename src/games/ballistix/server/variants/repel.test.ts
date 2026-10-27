import { describe, expect, it } from 'vitest';
import { defaultOptions, optionsFor } from '../../../../core/shared/catalog';
import { VARIANTS, applyOptions, createBallArena } from './index';
import { applyRepelOptions, type RepelConfig } from './repel';
import type { VariantConfig } from './config';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const crash = VARIANTS.find((v) => v.id === 'smashball')!;
const nb = VARIANTS.find((v) => v.id === 'pulse-ball')!;
const mod = (g: unknown) => (g as { modules: { id: string }[] }).modules.find((m) => m.id === 'repel') as any;
const idle = { mx: 0, my: 0, a1: false, a2: false };
const REPEL: RepelConfig = { every: 20, variance: 10, duration: 6, durationVariance: 0, radius: 150, force: 2400, itemLife: 10, itemVariance: 0 };

/** Smashball core plus a repel section: the module in isolation, no enemy. */
function game(repel: Partial<RepelConfig> = {}, seed = 3) {
  const base: VariantConfig = { ...crash, repel: { ...REPEL, ...repel } };
  const g = createBallArena({ ...applyOptions(base, { lives: 15, timeLimit: 300, balls: '1', maxBalls: 1 }) }, seed);
  g.init(players(2));
  return g;
}

describe('Repel option handling', () => {
  const opts = (o: Record<string, number | boolean | string>) => {
    const cfg: VariantConfig = { ...crash, repel: { ...REPEL } };
    applyRepelOptions(cfg, o);
    return cfg;
  };

  it('does nothing for a variant without a repel section', () => {
    const cfg: VariantConfig = { ...crash };
    applyRepelOptions(cfg, { repelEvery: 30, repelEnabled: true });
    expect(cfg.repel).toBeUndefined();
  });

  it('removes the section when disabled, even with other repel options', () => {
    expect(opts({ repelEnabled: false, repelEvery: 30 }).repel).toBeUndefined();
  });

  it('keeps unset values and clamps the given ones to their ranges', () => {
    expect(opts({}).repel).toEqual(REPEL);
    expect(opts({ repelEvery: 1, repelDuration: 99, repelRadius: 1, repelForce: 1e6, repelItemLife: 0 }).repel).toEqual({
      ...REPEL,
      every: 10,
      duration: 30,
      radius: 60,
      force: 6000,
      itemLife: 5,
    });
    expect(opts({ repelEvery: 55, repelRadius: 222 }).repel).toMatchObject({ every: 55, radius: 222, duration: 6 });
  });

  it('ignores non-numeric values', () => {
    expect(opts({ repelEvery: '30', repelForce: Number.NaN, repelRadius: true }).repel).toEqual(REPEL);
  });

  it('only pulse-ball ships it; its catalog defaults match', () => {
    expect(VARIANTS.filter((v) => v.repel).map((v) => v.id)).toEqual(['pulse-ball']);
    const d = defaultOptions(optionsFor('ballistix', 'pulse-ball'));
    expect(d.repelEvery).toBe(nb.repel!.every);
    expect(d.repelRadius).toBe(nb.repel!.radius);
  });
});

describe('Repel module', () => {
  it('schedules the first item within +-50 % of the interval, then spawns in a corner', () => {
    const g = game({ every: 20 });
    const wait = mod(g).wait as number;
    expect(wait).toBeGreaterThanOrEqual(10);
    expect(wait).toBeLessThanOrEqual(30);
    mod(g).wait = 0.05;
    g.update(0.1);
    const it = g.getState().repel!.item!;
    expect([Math.abs(it.x - 500), Math.abs(it.y - 500)]).toEqual([316, 316]);
    expect(it.life).toBe(1);
    expect(g.drainEvents().map((e) => e.kind)).toContain('spawn');
  });

  it('never picks the same corner twice in a row', () => {
    const g = game({ itemLife: 5 });
    const corners: number[] = [];
    for (let n = 0; n < 12; n++) {
      mod(g).item = null;
      mod(g).wait = 0;
      g.update(1 / 60);
      corners.push(mod(g).item.corner);
    }
    for (let i = 1; i < corners.length; i++) expect(corners[i]).not.toBe(corners[i - 1]);
  });

  it('an untouched item vanishes after itemLife and the timer restarts', () => {
    const g = game({ itemLife: 5 });
    mod(g).item = { x: 184, y: 184, corner: 0, left: 5, total: 5 };
    for (let i = 0; i < 60 * 3; i++) g.update(1 / 60);
    const life = g.getState().repel!.item!.life;
    expect(life).toBeGreaterThan(0.3);
    expect(life).toBeLessThan(0.5);
    for (let i = 0; i < 60 * 3; i++) g.update(1 / 60);
    expect(g.getState().repel!.item).toBeNull();
    expect(mod(g).wait).toBeGreaterThan(0);
  });

  it('a paddle far from the corner does not take the item; a dead one cannot', () => {
    const g = game();
    mod(g).wait = 999;
    mod(g).item = { x: 184, y: 184, corner: 0, left: 10, total: 10 };
    g.handleInput('p0', idle);
    g.update(1 / 60);
    expect(mod(g).item).not.toBeNull();
    // right at p0's paddle (bottom, centred) but p0 is dead: nobody gets it
    for (const p of (g as any).paddles) if (p.id === 'p0') p.alive = false;
    mod(g).item = { x: 500, y: 880, corner: 3, left: 10, total: 10 };
    g.update(1 / 60);
    expect(mod(g).item).not.toBeNull();
    expect(mod(g).effect.size).toBe(0);
  });

  it('picking up reports the remaining effect as a fraction and removes the item', () => {
    const g = game({ duration: 6 });
    mod(g).wait = 999;
    mod(g).item = { x: 500, y: 880, corner: 3, left: 10, total: 10 };
    g.update(1 / 60);
    const kinds = g.drainEvents().map((e) => e.kind);
    expect(kinds).toContain('pickup');
    const rep = g.getState().repel!;
    expect(rep.item).toBeNull();
    expect(rep.radius).toBe(150);
    expect(rep.paddles).toHaveLength(1);
    expect(rep.paddles[0].left).toBe(1);
    for (let i = 0; i < 60 * 3; i++) g.update(1 / 60);
    expect(g.getState().repel!.paddles[0].left).toBeCloseTo(0.5, 1);
  });

  it('only pushes balls on the field side of the goal line', () => {
    const g = game({ radius: 400, force: 6000 });
    mod(g).wait = 999;
    mod(g).effect.set('p0', { left: 8, total: 8 });
    const b = { x: 500, y: 960, vx: 0, vy: 0 } as any; // behind the bottom paddle
    mod(g).forceBall(b, 1 / 60);
    expect(b.vy).toBe(0);
    const f = { x: 500, y: 700, vx: 0, vy: 0 } as any;
    mod(g).forceBall(f, 1 / 60);
    expect(f.vy).toBeLessThan(0);
    // force halves toward the edge of the radius
    const near = { x: 500, y: 850, vx: 0, vy: 0 } as any;
    const far = { x: 500, y: 850 - 380, vx: 0, vy: 0 } as any;
    mod(g).forceBall(near, 1 / 60);
    mod(g).forceBall(far, 1 / 60);
    expect(Math.hypot(near.vx, near.vy)).toBeGreaterThan(Math.hypot(far.vx, far.vy));
  });

  it('a paddle that leaves loses the effect; init resets everything', () => {
    const g = game();
    mod(g).effect.set('p0', { left: 5, total: 5 });
    mod(g).paddleGone({ id: 'p0' });
    expect(mod(g).effect.size).toBe(0);
    mod(g).effect.set('p1', { left: 5, total: 5 });
    mod(g).item = { x: 184, y: 184, corner: 0, left: 5, total: 5 };
    mod(g).init();
    expect(mod(g).effect.size).toBe(0);
    expect(mod(g).item).toBeNull();
    expect(mod(g).lastCorner).toBe(-1);
  });
});
