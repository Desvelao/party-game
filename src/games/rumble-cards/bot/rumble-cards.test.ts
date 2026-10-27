import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import manifest from '../game.json';
import { applyOptions } from '../server/config';
import { RumbleCards } from '../server/RumbleCards';
import { CARDS } from '../shared/cards';
import type { CardsState } from '../shared/types';
import { rumbleCards } from './index';
import { LEVEL_ORDER, LEVELS } from './levels';
import { DEFAULT_PARAMS } from './params';
import { PlannerPolicy } from './policy/planner';
import { playRound } from './sim';
import { WorldModel } from './world';

const card = (name: string) => CARDS.findIndex((c) => c.name === name);

function table(hand: number[], over: Partial<CardsState> = {}, foeHp = 10) {
  const p = (id: string, hp: number) => ({ id, hero: 0, hp, maxHp: 10, hand: 3, deck: 20, disc: 0, def: [] as [number, number][], out: false });
  const s: CardsState = { kind: 'ext:rumble-cards', t: 0, players: [p('me', 10), p('foe', foeHp), p('mate', 10)], turn: 'me', made: 0, left: 1, tt: 20, ttMax: 20, purge: 0, aim: 'foe', last: null, ...over } as CardsState;
  const wm = new WorldModel('me', new Set(['mate']));
  wm.setPrivate({ hand, cur: 0 });
  return wm.update(s, 0, 0);
}
const best = (w: ReturnType<typeof table>, params: Record<string, number> = {}) => new PlannerPolicy({ ...DEFAULT_PARAMS, ...params }, () => 0.5).next(w);

describe('planner', () => {
  it('plays an extra-play card first', () => {
    const p = best(table([card('Pounce'), card('Quick Dash')]));
    expect(p).toMatchObject({ kind: 'play', card: 1 });
  });

  it('finishes a rival it can knock out, and never aims at a teammate', () => {
    const p = best(table([card('Zap'), card('Fur Shield')], {}, 1));
    expect(p).toMatchObject({ kind: 'play', card: 0, target: 'foe' });
  });

  it('ends the turn rather than heal at full health after a play', () => {
    expect(best(table([card('Nap')], { made: 1 }))).toMatchObject({ kind: 'end' });
  });
});

describe('discarding', () => {
  it('over the hand limit it throws away the card worth least, never plays', () => {
    const w = table([card('Zap'), card('Nap'), card('Pounce')], { made: 1, purge: 1 });
    // at full health a heal is worth nothing, so Nap is the one to go
    expect(best(w)).toMatchObject({ kind: 'discard', card: 1 });
  });

  it('plays whole rounds with a tight hand limit: it discards, never times out', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const r = playRound('rumble-cards', [{ level: 'semigod' }, { level: 'normal' }], { seed, options: { hand: 5, maxHand: 2 }, clock: () => performance.now() });
      expect(r.places).toHaveLength(2);
      for (const m of r.metrics) expect(m.timeouts).toBe(0);
      expect(r.metrics[0].discards + r.metrics[1].discards).toBeGreaterThan(0);
    }
  });
});

describe('rules contract (if one fails, the game changed: see src/games/rumble-cards/AGENTS.md)', () => {
  it('has no variants', () => {
    expect(manifest.catalog.variants).toEqual([]);
  });

  it('presses (not holds) move the card and the aim, and A plays the selected card at the aim', () => {
    const g = new RumbleCards(applyOptions({}), () => 0.1, [0, 1, 2]);
    g.init([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }, { id: 'c', name: 'c' }]);
    const turn = g.getState().turn;
    const hand = (g.getPrivateState(turn) as { hand: number[] }).hand;
    g.handleInput(turn, { mx: 1, my: 0, a1: false, a2: false });
    g.handleInput(turn, { mx: 1, my: 0, a1: false, a2: false });
    expect((g.getPrivateState(turn) as { cur: number }).cur).toBe(1);
    const aim0 = g.getState().aim;
    g.handleInput(turn, { mx: 0, my: 1, a1: false, a2: false });
    expect(g.getState().aim).not.toBe(aim0);
    g.handleInput(turn, { mx: 0, my: 0, a1: true, a2: false });
    expect(g.getState().last?.c).toBe(hand[1]);
  });
});

describe('levels', () => {
  it('are ordered and only use known parameters', () => {
    expect(LEVEL_ORDER).toEqual(['easy', 'normal', 'hard', 'expert', 'semigod']);
    for (const l of LEVEL_ORDER) for (const k of Object.keys(LEVELS[l])) expect(DEFAULT_PARAMS).toHaveProperty(k);
    expect(rumbleCards.levels).toBe(LEVELS);
  });
});

describe('headless rounds', () => {
  it('plays whole rounds through the controls, with no timeouts, cheaply', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const r = playRound('rumble-cards', [{ level: 'semigod' }, { level: 'normal' }, { level: 'easy' }, { level: 'hard', allies: [0] }], { seed, clock: () => performance.now() });
      expect(r.places).toHaveLength(4);
      for (const m of r.metrics) expect(m.timeouts).toBe(0);
      expect(r.metrics[0].plays).toBeGreaterThan(0);
      expect(r.p99DecideMs).toBeLessThan(25); // headroom: the full suite runs files in parallel
    }
  });

  it('semigod beats random cards', () => {
    let wins = 0;
    const n = 20;
    for (let i = 0; i < n; i++) {
      const swap = i % 2 === 1;
      const seats = swap ? [{ params: { mistake: 1 } }, { level: 'semigod' }] : [{ level: 'semigod' }, { params: { mistake: 1 } }];
      const r = playRound('rumble-cards', seats, { seed: 50 + i });
      const god = swap ? 1 : 0;
      if (r.places[god] < r.places[1 - god]) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(12);
  });
});
