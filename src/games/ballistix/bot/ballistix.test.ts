import { describe, expect, it } from 'vitest';
import { rotQuarter } from '../shared/geometry';
import type { BallArenaState } from '../shared/types';
import { ballistix } from './index';
import { LEVELS, LEVEL_ORDER } from './levels';
import { advance, contactY, project, type Env } from './physics';
import { WorldModel } from './world';

const C = 500;
const env: Env = { r: 18, open: [false, true, true, true], obstacles: [] };

function state(side: number, balls: { id: number; x: number; y: number }[], padPos = 0, lives = 5): BallArenaState {
  return {
    kind: 'ext:ballistix',
    variant: 'smashball',
    t: 0,
    limit: 150,
    boostRadius: 150,
    sides: [0, 1, 2, 3].map((s) => ({ side: s, used: true, alive: true, lives, maxLives: 5 })),
    paddles: [{ id: 'me', side, pos: padPos, len: 130, alive: true, d: 1, pulse: 0 }],
    balls: balls.map((b) => ({ ...b, r: 18, wait: false, corner: -1, boost: 0 })),
  };
}

describe('physics', () => {
  it('projects a straight ball to the goal line', () => {
    const imp = project({ x: 100, y: 0, vx: 0, vy: 400 }, env, 3)!;
    expect(imp.x).toBeCloseTo(100, 0);
    expect(imp.t).toBeCloseTo((contactY(18) - 0) / 400, 1);
  });

  it('reflects off a solid wall', () => {
    const walled: Env = { ...env, open: [false, false, true, true] };
    const imp = project({ x: -300, y: 0, vx: -300, vy: 300 }, walled, 4)!;
    expect(imp).not.toBeNull();
    expect(imp.bounces).toBeGreaterThan(0);
  });

  it('a ball leaving through a living goal is no threat', () => {
    expect(project({ x: 0, y: 0, vx: 0, vy: -400 }, env, 4)).toBeNull();
  });

  it('advance keeps a free ball moving in a line', () => {
    const b = advance({ x: 0, y: 0, vx: 100, vy: 50 }, 1, env);
    expect(b.x).toBeCloseTo(100, 0);
    expect(b.y).toBeCloseTo(50, 0);
  });
});

describe('world frame', () => {
  it('maps every side to "my goal at the bottom"', () => {
    for (const side of [0, 1, 2, 3]) {
      const m = new WorldModel('me', 60);
      // a ball 300 px deep on my side, 40 px right of centre in my own frame
      const [dx, dy] = rotQuarter(40, 300, side);
      const w = m.update(state(side, [{ id: 1, x: C + dx, y: C + dy }]), 1, 0)!;
      expect(w.balls[0].x).toBeCloseTo(40);
      expect(w.balls[0].y).toBeCloseTo(300);
    }
  });

  it('estimates velocity across snapshots', () => {
    const m = new WorldModel('me', 20);
    m.update(state(0, [{ id: 1, x: C, y: C }]), 0, 0);
    const w = m.update(state(0, [{ id: 1, x: C + 10, y: C + 20 }]), 1, 50)!;
    expect(w.balls[0].vx).toBeCloseTo(200);
    expect(w.balls[0].vy).toBeCloseTo(400);
  });
});

describe('predictive policy', () => {
  const make = () => ballistix.create({ selfId: 'me', name: 'b', tickRate: 60, networkRate: 20, seed: 1, params: ballistix.defaultParams }, 'predictive');

  it('moves under an incoming ball', () => {
    const bot = make();
    bot.onState(state(0, [{ id: 1, x: C + 200, y: C }]), { tick: 0, phase: 'playing', recvMs: 0 });
    bot.onState(state(0, [{ id: 1, x: C + 200, y: C + 20 }]), { tick: 3, phase: 'playing', recvMs: 50 });
    const input = bot.decide(50);
    expect(input.mx).toBeGreaterThan(0.5);
  });

  it('classifies a goal conceded to an untracked ball', () => {
    const bot = make();
    bot.onState(state(0, [{ id: 1, x: C, y: C + 390 }]), { tick: 0, phase: 'playing', recvMs: 0 });
    bot.decide(0);
    const inc = bot.onEvents([{ kind: 'goal', id: 'me', x: C, y: C + 420 }]);
    expect(inc).toHaveLength(1);
    expect(inc[0].cause).toBe('never-predicted');
  });

  it('smashes to save an unreachable close ball', () => {
    const bot = make();
    bot.onState(state(0, [{ id: 1, x: C + 100, y: C + 280 }], -20), { tick: 0, phase: 'playing', recvMs: 0 });
    bot.onState(state(0, [{ id: 1, x: C + 100, y: C + 300 }], -20), { tick: 3, phase: 'playing', recvMs: 50 });
    expect(bot.decide(50).a1).toBe(true);
  });
});

describe('levels', () => {
  it('only use known parameters and get stricter', () => {
    for (const [name, preset] of Object.entries(LEVELS)) {
      for (const k of Object.keys(preset)) expect(ballistix.defaultParams, `${name}.${k}`).toHaveProperty(k);
    }
    const react = LEVEL_ORDER.map((l) => LEVELS[l].reactionMs);
    expect([...react].sort((a, b) => b - a)).toEqual(react);
  });

  const mk = (params: Record<string, number>) =>
    ballistix.create({ selfId: 'me', name: 'b', tickRate: 60, networkRate: 20, seed: 1, params: { ...ballistix.defaultParams, ...params } }, 'predictive');
  const feed = (bot: ReturnType<typeof mk>, x1: number, x2: number, t: number) => {
    bot.onState(state(0, [{ id: 1, x: C + x1, y: C }]), { tick: 0, phase: 'playing', recvMs: t });
    bot.onState(state(0, [{ id: 1, x: C + x2, y: C + 20 }]), { tick: 3, phase: 'playing', recvMs: t + 50 });
  };

  it('a reaction delay makes the bot act on old snapshots', () => {
    const fast = mk({});
    const slow = mk({ reactionMs: 300 });
    for (const b of [fast, slow]) feed(b, 200, 200, 0);
    fast.decide(60);
    slow.decide(60);
    expect(fast.trace()!.threats).toBe(1);
    // the only snapshots are younger than 300 ms: the slow bot still uses the oldest, which has no velocity yet
    expect(slow.trace()!.threats).toBe(0);
  });

  it('the speed cap limits the paddle command', () => {
    const bot = mk({ speed: 0.5 });
    feed(bot, 300, 300, 0);
    expect(Math.abs(bot.decide(60).mx)).toBeLessThanOrEqual(0.5);
  });

  it('does not predict balls with more bounces than maxBounces', () => {
    const blind = mk({ maxBounces: -1 });
    feed(blind, 200, 200, 0);
    blind.decide(60);
    expect(blind.trace()!.threats).toBe(0);
  });
});
