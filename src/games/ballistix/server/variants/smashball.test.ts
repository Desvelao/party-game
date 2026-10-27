import { describe, expect, it } from 'vitest';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../../core/shared/catalog';
import { CORE_DEFAULTS } from '../core/config';
import { VARIANTS, applyOptions, createBallArena } from './index';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const crash = VARIANTS.find((v) => v.id === 'smashball')!;
const idle = { mx: 0, my: 0, a1: false, a2: false };
const make = (opts: Record<string, number | boolean | string> = {}, n = 2, seed = 1) => {
  const g = createBallArena(applyOptions(crash, opts), seed);
  g.init(players(n));
  return g;
};
/** the side record of player `id` */
const sideOf = (g: unknown, id: string) => {
  const pad = (g as { paddles: { id: string; side: number }[] }).paddles.find((p) => p.id === id)!;
  return sides(g)[pad.side];
};
const sides = (g: unknown) => (g as { sides: { lives: number; alive: boolean; conceded: number; elimOrder: number }[] }).sides;

describe('Smashball baseline', () => {
  it('is the core rules and nothing else', () => {
    expect(crash.name).toBe('Smashball');
    expect(crash).toMatchObject({ lives: CORE_DEFAULTS.lives, ballSpeed: CORE_DEFAULTS.ballSpeed, paddleLen: CORE_DEFAULTS.paddleLen });
    for (const k of ['magnet', 'enemy', 'repel', 'engines'] as const) expect(crash[k]).toBeUndefined();
    const st = make().getState();
    for (const k of ['magnet', 'enemy', 'repel', 'engines'] as const) expect(st[k]).toBeUndefined();
  });

  it('is first in the rotation and catalog defaults match', () => {
    expect(VARIANTS[0].id).toBe('smashball');
    const d = defaultOptions(optionsFor('ballistix', 'smashball'));
    expect(d.lives).toBe(crash.lives);
    expect(d.ballSpeed).toBe(crash.ballSpeed);
    expect(d.timeLimit).toBe(crash.timeLimit);
    expect(d.paddleLen).toBe(crash.paddleLen);
  });

  it('applies core options with clamping, without mutating the base config', () => {
    const before = { ...crash, spawn: { ...crash.spawn }, reinforce: { ...crash.reinforce } };
    const cfg = applyOptions(crash, { lives: 99, ballSpeed: 5000, paddleLen: 10, timeLimit: 1, maxBalls: 3 });
    expect(cfg.lives).toBe(15);
    expect(cfg.ballMaxSpeed).toBe(crash.ballMaxSpeed);
    expect(cfg.ballSpeed).toBeLessThanOrEqual(700);
    expect(cfg.paddleLen).toBe(60);
    expect(cfg.timeLimit).toBe(30);
    expect(cfg.reinforce.max).toBe(3);
    expect(crash.lives).toBe(before.lives);
    expect(crash.spawn).toEqual(before.spawn);
    expect(crash.reinforce).toEqual(before.reinforce);
    // module options of other variants are ignored
    expect(applyOptions(crash, { enemyEnabled: true, repelEvery: 20 }).repel).toBeUndefined();
    expect(normalizeSelection('ballistix', 'smashball', { enemyRate: 2 })).toBeNull();
  });

  it('starts every used side with the configured lives', () => {
    const g = make({ lives: 4 }, 3);
    const st = g.getState();
    expect(st.paddles).toHaveLength(3);
    expect(sides(g).filter((s) => s.alive).map((s) => s.lives)).toEqual([4, 4, 4]);
    expect(g.isFinished()).toBe(false);
  });
});

describe('Smashball placements', () => {
  it('rank by lives left, then fewer goals conceded; ties share a place', () => {
    const g = make({ lives: 5 }, 3);
    const s = [0, 1, 2].map((i) => sideOf(g, `p${i}`));
    s[0].lives = 4;
    s[1].lives = 2;
    s[2].lives = 4;
    s[0].conceded = 1;
    s[2].conceded = 3;
    const place = Object.fromEntries(g.getPlacements().map((p) => [p.id, p.place]));
    expect(place).toEqual({ p0: 1, p2: 2, p1: 3 });
    s[2].conceded = 1;
    expect(g.getPlacements().filter((p) => p.place === 1)).toHaveLength(2);
  });

  it('eliminated sides rank below the living, later elimination first', () => {
    const g = make({ lives: 3 }, 4);
    const s = [0, 1, 2, 3].map((i) => sideOf(g, `p${i}`));
    Object.assign(s[3], { alive: false, lives: 0, elimOrder: 1 });
    Object.assign(s[1], { alive: false, lives: 0, elimOrder: 2 });
    s[0].lives = 1;
    s[2].lives = 3;
    const place = Object.fromEntries(g.getPlacements().map((p) => [p.id, p.place]));
    expect(place.p2).toBe(1);
    expect(place.p0).toBe(2);
    expect(place.p1).toBe(3);
    expect(place.p3).toBe(4);
  });

  it('finishes when one side is left and the survivor wins', () => {
    const g = make({ lives: 2 });
    sideOf(g, 'p1').alive = false;
    g.handleInput('p0', idle);
    g.update(1 / 60);
    expect(g.isFinished()).toBe(true);
    expect(g.getPlacements().find((p) => p.id === 'p0')!.place).toBe(1);
  });

  it('finishes at the time limit with an unchanged ranking', () => {
    const g = make({ lives: 15, timeLimit: 30 });
    (g as any).t = 29.99;
    g.update(0.02);
    expect(g.isFinished()).toBe(true);
    expect(g.getPlacements().map((p) => p.place)).toEqual([1, 1]);
  });
});
