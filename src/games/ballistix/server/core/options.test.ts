import { describe, expect, it } from 'vitest';
import { CORNER_SIZE, FIELD_HALF } from '../../shared/geometry';
import { defaultOptions, normalizeSelection, optionsFor } from '../../../../core/shared/catalog';
import { createBallArena } from '../variants';
import type { BallArena } from './BallArena';
import { VARIANTS, applyOptions } from '../variants';
import { createMinigame } from '../../../../core/server/minigames';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const crash = VARIANTS.find((v) => v.id === 'smashball')!;
const game = (opts: Record<string, number | boolean | string>, seed = 1) => createBallArena(applyOptions(crash, opts), seed);

describe('option validation', () => {
  it('rejects unknown ids, wrong types and bad choices', () => {
    expect(normalizeSelection('ballistix', 'smashball', { nope: 1 })).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', { lives: '5' })).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', { balls: '9' })).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', { smashEnabled: 1 })).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', [])).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', { lives: NaN })).toBeNull();
  });

  it('clamps, snaps to step and drops defaults', () => {
    const sel = normalizeSelection('ballistix', 'smashball', { lives: 99, smashGain: 1.77, hitGain: 1.05, balls: 'auto' })!;
    expect(sel.options).toEqual({ lives: 15, smashGain: 1.8 });
  });

  it('no options for mixed, rotating variants or other variants', () => {
    expect(normalizeSelection('mixed', 'all', { lives: 3 })).toBeNull();
    expect(normalizeSelection('ballistix', 'all', { lives: 3 })).toBeNull();
    // options belong to a variant: another variant's setting is rejected
    expect(normalizeSelection('ballistix', 'cloud-orbs', { enemyRate: 3 })).toBeNull();
    expect(normalizeSelection('ballistix', 'smashball', { failPull: 300 })).toBeNull();
    expect(normalizeSelection('crazy-logs', 'all', { lives: 3 })).toBeNull();
    expect(optionsFor('ballistix', 'smashball').length).toBeGreaterThan(5);
  });

  it('catalog defaults match the server config', () => {
    const d = defaultOptions(optionsFor('ballistix', 'smashball'));
    const cfg = crash;
    expect(d.lives).toBe(cfg.lives);
    expect(d.ballSpeed).toBe(cfg.ballSpeed);
    expect(d.ballMaxSpeed).toBe(cfg.ballMaxSpeed);
    expect(d.hitGain).toBe(cfg.hitGain);
    expect(d.smashGain).toBe(cfg.smashGain);
    expect(d.smashCooldown).toBe(cfg.smashCooldown);
    expect(d.smashEnabled).toBe(cfg.smashEnabled);
    expect(d.smashRadius).toBe(cfg.smashRadius);
    expect(d.paddleLen).toBe(cfg.paddleLen);
    expect(d.spawnDelay).toBe(cfg.spawn.delay);
    expect(d.spawnDelayVariance).toBe(cfg.spawn.variance);
    expect(d.ballSpawnVariance).toBe(cfg.reinforce.variance);
    expect(d.timeLimit).toBe(cfg.timeLimit);
    // applying the defaults is a no-op
    expect(applyOptions(crash, d)).toMatchObject({ ...cfg, startBalls: expect.any(Function) });
  });
});

describe('options change the game', () => {
  it('lives applies to every side', () => {
    const st = (() => {
      const g = game({ lives: 2 });
      g.init(players(2));
      return g.getState();
    })();
    expect(st.sides.filter((s) => s.used).every((s) => s.lives === 2 && s.maxLives === 2)).toBe(true);
  });

  it('balls forces the ball count', () => {
    const g = game({ balls: '3' });
    g.init(players(2));
    expect(g.getState().balls).toHaveLength(3);
    const auto = game({});
    auto.init(players(2));
    expect(auto.getState().balls).toHaveLength(1);
  });

  it('timeLimit ends the round', () => {
    const g = game({ timeLimit: 30, lives: 15 });
    g.init(players(2));
    for (let i = 0; i < 60 * 31; i++) {
      g.handleInput('p0', { mx: 0, my: 0, a1: false, a2: false });
      g.update(1 / 60);
    }
    expect(g.isFinished()).toBe(true);
  });

  it('smashEnabled=false never pulses', () => {
    const g = game({ smashEnabled: false });
    g.init(players(2));
    let pulsed = false;
    for (let i = 0; i < 60 * 40 && !g.isFinished(); i++) {
      for (const id of ['p0', 'p1']) g.handleInput(id, { mx: Math.sin(i / 20), my: 0, a1: i % 30 < 15, a2: false });
      g.update(1 / 60);
      if (g.getState().paddles.some((p) => p.pulse > 0)) pulsed = true;
      if (g.drainEvents().some((e) => e.kind === 'smash')) pulsed = true;
    }
    expect(pulsed).toBe(false);
  });

  it('a higher boost multiplier sends the ball away faster', () => {
    const speedAfterPulse = (gain: number) => {
      const g = game({ smashGain: gain, smashRadius: 400 }, 11);
      g.init(players(2));
      for (let i = 0; i < 60 * 20 && !g.getState().balls.some((b) => !b.wait); i++) g.update(1 / 60);
      const id = g.getState().balls.find((b) => !b.wait)!.id;
      g.handleInput('p0', { mx: 0, my: 0, a1: true, a2: false });
      const b0 = g.getState().balls.find((b) => b.id === id)!;
      g.update(1 / 60);
      const b1 = g.getState().balls.find((b) => b.id === id)!;
      return Math.hypot(b1.x - b0.x, b1.y - b0.y) * 60;
    };
    expect(speedAfterPulse(2.4)).toBeGreaterThan(speedAfterPulse(1.3) * 1.2);
  });

  it('the extreme settings never tunnel the ball out of the field', () => {
    const g = game(
      { ballMaxSpeed: 900, ballSpeed: 700, hitGain: 1.3, smashGain: 2.5, lives: 15, spawnDelay: 0.5, balls: '4', paddleLen: 60 },
      9,
    );
    g.init(players(4));
    for (let i = 0; i < 60 * 120 && !g.isFinished(); i++) {
      for (const p of g.getState().paddles) g.handleInput(p.id, { mx: Math.sin(i / 17 + p.side), my: 0, a1: i % 50 === 0, a2: false });
      g.update(1 / 60);
      for (const b of g.getState().balls) {
        if (b.wait) continue;
        expect(Math.abs(b.x - 500)).toBeLessThanOrEqual(FIELD_HALF + 60);
        expect(Math.abs(b.y - 500)).toBeLessThanOrEqual(FIELD_HALF + 60);
      }
    }
    expect(CORNER_SIZE).toBeGreaterThan(0);
  });

  it('createMinigame passes the room options through', () => {
    const sel = normalizeSelection('ballistix', 'smashball', { lives: 3 })!;
    const g = createMinigame(sel, 0) as BallArena;
    g.init(players(2));
    expect(g.getState().sides.find((s) => s.used)!.maxLives).toBe(3);
  });
});
