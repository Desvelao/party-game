import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import manifest from '../game.json';
import { applyOptions } from '../server/config';
import { CrazyLogs } from '../server/CrazyLogs';
import type { LogsState } from '../shared/types';
import { crazyLogs } from './index';
import { LEVEL_ORDER, LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { HOP_TIME, LOGS_FINISH_Y, LOGS_START_Y, groundAt } from './physics';
import { HopperPolicy } from './policy/hopper';
import { playRound } from './sim';
import { WorldModel } from './world';

const rows = [760, 660, 560, 460, 360, 260].map((y) => ({ v: 0, ph: 0, y }));

function snap(me: Partial<LogsState['players'][0]>, over: Partial<LogsState> = {}): LogsState {
  return { kind: 'ext:crazy-logs', t: 0, limit: 60, rows, half: 32, jets: [], players: [{ id: 'me', x: 500, y: 875, f: 0, alive: true, h: 0, d: 1, score: 0, falls: 0, w: 0, ...me }], ...over };
}

describe('physics', () => {
  it('knows the banks, the logs and the water', () => {
    expect(groundAt(500, LOGS_START_Y + 5, rows, 32).kind).toBe('start');
    expect(groundAt(500, LOGS_FINISH_Y - 5, rows, 32).kind).toBe('finish');
    expect(groundAt(500, 760, rows, 32)).toEqual({ kind: 'log', row: 0 });
    expect(groundAt(500, 710, rows, 32).kind).toBe('water');
    expect(groundAt(500, 710, rows, 32, 20)).toEqual({ kind: 'log', row: 0 });
  });
});

describe('world', () => {
  it('learns the hop length from two mid-air samples', () => {
    const wm = new WorldModel('me', 60);
    wm.update(snap({ x: 500, y: 760, h: 0.2 }), 0, 0);
    const w = wm.update(snap({ x: 500, y: 760 - 130 * 0.3, h: 0.5 }), 3, 50);
    expect(w.hop).toBeGreaterThan(110);
  });
});

describe('hopper', () => {
  const P = { ...DEFAULT_PARAMS };
  const view = (s: LogsState) => new WorldModel('me', 60).update(s, 0, 0);

  it('lands where the hop cancels a spinning log', () => {
    const spun = rows.map((r, i) => (i === 1 ? { ...r, v: 60 } : r));
    const s = snap({ x: 500, y: 740 }, { rows: spun });
    const w = view(s);
    const d = new HopperPolicy(P, () => 0.5).decide(w, { me: s.players[0], ground: w.ground, readyMs: 1000 }, 0);
    expect(d.hop).toBe(true);
    // spin +60 (towards the start bank) is cancelled by landing on the far half (negative offset)
    expect(d.ty!).toBeLessThan(660);
    // the stick sets the landing: dy = hop * my
    expect(740 + d.my * 100).toBeCloseTo(d.ty!, 0);
  });

  it('walks up the bank until the first log is in reach', () => {
    const s = snap({});
    const w = view(s);
    const d = new HopperPolicy(P, () => 0.5).decide(w, { me: s.players[0], ground: w.ground, readyMs: 1000 }, 0);
    expect(d.hop).toBe(false);
    expect(d.my).toBeLessThan(0);
  });
});

describe('rules contract (if one fails, the game changed: see src/games/crazy-logs/AGENTS.md)', () => {
  it('has no variants (the bot reads host options from what it sees)', () => {
    expect(manifest.catalog.variants).toEqual([]);
  });

  it('has a ladder scenario for the default options and for jets, long hops and few logs, with options the game applies', () => {
    const dir = new URL('../../../../bot/scenarios/', import.meta.url);
    for (const name of ['', '-jets', '-long-hop', '-few-logs']) {
      const sc = JSON.parse(readFileSync(new URL(`ladder-crazy-logs${name}.json`, dir), 'utf8')) as { game: string; options: Record<string, number | boolean> };
      expect(sc.game).toBe('crazy-logs');
      const cfg = applyOptions(sc.options) as unknown as Record<string, unknown>;
      for (const k of Object.keys(sc.options)) expect(cfg).toHaveProperty(k === 'stability' ? 'landImpulse' : k);
    }
  });

  it('a1 held hops hopDistance towards the stick, in HOP_TIME', () => {
    const g = new CrazyLogs(applyOptions({ hopDistance: 120 }), () => 0.5);
    g.init([{ id: 'a', name: 'a' }]);
    for (let i = 0; i < 30; i++) {
      g.handleInput('a', { mx: 0, my: -1, a1: false, a2: false });
      g.update(1 / 60);
    }
    const y0 = g.getState().players[0].y;
    g.handleInput('a', { mx: 0.6, my: -0.8, a1: true, a2: false });
    for (let i = 0; i < Math.round(HOP_TIME * 60) + 1; i++) g.update(1 / 60);
    const p = g.getState().players[0];
    expect(p.y).toBeCloseTo(y0 - 96, 0);
  });
});

describe('levels', () => {
  it('are ordered and only use known parameters', () => {
    expect(LEVEL_ORDER).toEqual(['easy', 'normal', 'hard', 'expert', 'semigod']);
    for (const l of LEVEL_ORDER) for (const k of Object.keys(LEVELS[l])) expect(DEFAULT_PARAMS).toHaveProperty(k);
    expect(crazyLogs.levels).toBe(LEVELS);
  });
});

describe('headless rounds', () => {
  it('stronger levels cross more often, cheaply', () => {
    const r = playRound('crazy-logs', [{ level: 'semigod' }, { level: 'normal' }, { level: 'easy' }], { options: { timeLimit: 40 }, seed: 2, clock: () => performance.now() });
    const score = r.metrics.map((m) => m.crossings);
    expect(score[0]).toBeGreaterThanOrEqual(score[1]);
    expect(score[1]).toBeGreaterThan(score[2]);
    expect(score[0]).toBeGreaterThan(5);
    expect(r.p99DecideMs).toBeLessThan(25); // headroom: the full suite runs files in parallel
  });

  it('plays with jets, few logs and long hops', () => {
    const sets: Record<string, number | boolean>[] = [{ jets: true, jetInterval: 3 }, { logCount: 4 }, { hopDistance: 130, stability: 0 }];
    for (const options of sets) {
      const r = playRound('crazy-logs', [{ level: 'hard' }, { level: 'easy' }], { options: { timeLimit: 30, ...options }, seed: 4 });
      expect(r.metrics[0].crossings).toBeGreaterThan(0);
    }
  });
});
