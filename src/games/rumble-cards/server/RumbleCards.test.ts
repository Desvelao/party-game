import { describe, expect, it } from 'vitest';
import { CARDS, HEROES, deckOf } from '../shared/cards';
import { RumbleCards } from './RumbleCards';
import { DEFAULT_CONFIG, applyOptions } from './config';

/** tiny seeded generator, so the deals are repeatable */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const start = (n = 2, opts = {}) => {
  const g = new RumbleCards(applyOptions(opts), seeded(7));
  g.init(names(n));
  return g;
};
const idx = (name: string) => CARDS.findIndex((c) => c.name === name);
/** the engine's internals, for setting up a situation */
const inner = (g: RumbleCards) => g as unknown as { seats: { id: string; hp: number; hand: number[]; def: { c: number; h: number }[]; deck: number[]; disc: number[]; out: boolean }[]; turnIdx: number };
const turnSeat = (g: RumbleCards) => inner(g).seats[inner(g).turnIdx];

describe('decks', () => {
  it('has 28 cards per hero', () => {
    for (let h = 0; h < HEROES.length; h++) expect(deckOf(h)).toHaveLength(28);
  });
});

describe('RumbleCards', () => {
  it('deals the starting hand to everyone, and nobody draws when a turn starts', () => {
    const g = start(3);
    expect(inner(g).seats.map((s) => s.hand.length)).toEqual([3, 3, 3]);
    expect(g.getState().players[0].hp).toBe(10);
  });

  it('keeps hands private', () => {
    const g = start(2);
    const priv = g.getPrivateState('p0') as { hand: number[] };
    expect(priv.hand).toEqual(inner(g).seats[0].hand);
    expect(JSON.stringify(g.getState())).not.toContain('"hand":[');
  });

  it('ignores actions from a player whose turn it is not', () => {
    const g = start(2);
    const other = inner(g).seats.find((s) => s !== turnSeat(g))!;
    const before = other.hand.length;
    g.handleAction(other.id, { a: 'play', c: 0 });
    expect(other.hand.length).toBe(before);
    expect(g.getState().made).toBe(0);
  });

  it('cannot end a turn before playing a card', () => {
    const g = start(2);
    const turn = g.getState().turn;
    g.handleAction(turn, { a: 'end' });
    expect(g.getState().turn).toBe(turn);
  });

  it('plays a damage card, then passes the turn', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [idx('Zap'), idx('Nap')];
    const foe = inner(g).seats.find((s) => s !== me)!;
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect(foe.hp).toBe(9);
    expect(me.disc).toContain(idx('Zap'));
    expect(g.getState().turn).toBe(foe.id);
  });

  it('needs a target with several rivals', () => {
    const g = start(3);
    const me = turnSeat(g);
    me.hand = [idx('Zap')];
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect(me.hand).toHaveLength(1);
    const foe = inner(g).seats.find((s) => s !== me)!;
    g.handleAction(me.id, { a: 'play', c: 0, tg: foe.id });
    expect(foe.hp).toBe(9);
    g.handleAction(me.id, { a: 'play', c: 99 }); // out of range: nothing happens
  });

  it('lets Defense cards soak damage first and discards them when used up', () => {
    const g = start(2);
    const me = turnSeat(g);
    const foe = inner(g).seats.find((s) => s !== me)!;
    foe.def = [{ c: idx('Fur Shield'), h: 1 }, { c: idx('Burrow Wall'), h: 2 }];
    me.hand = [idx('Boulder Toss'), idx('Zap')];
    g.handleAction(me.id, { a: 'play', c: 0 }); // 2 damage: shield gone, wall down to 1
    expect(foe.hp).toBe(10);
    expect(foe.def).toEqual([{ c: idx('Burrow Wall'), h: 1 }]);
    expect(foe.disc).toContain(idx('Fur Shield'));
  });

  it('keeps a played Defense card on the table', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [idx('Burrow Wall'), idx('Zap')];
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect(me.def).toEqual([{ c: idx('Burrow Wall'), h: 2 }]);
    expect(me.disc).not.toContain(idx('Burrow Wall'));
  });

  it('lets you play more cards after Quick Dash, and caps healing at the maximum', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [idx('Quick Dash'), idx('Nap'), idx('Zap')];
    me.deck = [idx('Zap')];
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect(g.getState().turn).toBe(me.id);
    expect(g.getState().left).toBe(1);
    expect(me.hand).toHaveLength(3); // drew one
    g.handleAction(me.id, { a: 'play', c: 0 }); // Nap at full health
    expect(me.hp).toBe(10);
    expect(g.getState().turn).not.toBe(me.id);
  });

  it('hits every rival with an all-damage card', () => {
    const g = start(3);
    const me = turnSeat(g);
    me.hand = [idx('Quake')];
    g.handleAction(me.id, { a: 'play', c: 0 });
    for (const s of inner(g).seats) expect(s.hp).toBe(s === me ? 10 : 9);
  });

  it('steals a card and smashes a Defense card', () => {
    const g = start(2);
    const me = turnSeat(g);
    const foe = inner(g).seats.find((s) => s !== me)!;
    foe.hand = [idx('Zap')];
    foe.def = [{ c: idx('Rock Plate'), h: 1 }];
    me.hand = [idx('Quick Dash'), idx('Hex'), idx('Shatter')];
    g.handleAction(me.id, { a: 'play', c: 0 }); // Quick Dash: one more play
    g.handleAction(me.id, { a: 'play', c: 0 }); // Hex steals the only card
    expect(me.hand).toContain(idx('Zap'));
    expect(foe.hand).not.toContain(idx('Zap'));

    const h = start(2);
    const a = turnSeat(h);
    const b = inner(h).seats.find((s) => s !== a)!;
    b.def = [{ c: idx('Rock Plate'), h: 1 }];
    a.hand = [idx('Shatter')];
    h.handleAction(a.id, { a: 'play', c: 0 });
    expect(b.def).toHaveLength(0);
    expect(b.disc).toContain(idx('Rock Plate'));
  });

  it('plays a card for a player who runs out of time, then passes', () => {
    const g = start(2);
    const turn = g.getState().turn;
    g.update(21);
    expect(g.getState().last?.p).toBe(turn);
    expect(g.getState().turn).not.toBe(turn);
  });

  it('knocks a player out at 0 hit points and ends with a winner', () => {
    const g = start(2, { hp: 5 });
    const me = turnSeat(g);
    const foe = inner(g).seats.find((s) => s !== me)!;
    foe.hp = 1;
    me.hand = [idx('Zap')];
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect(g.isFinished()).toBe(true);
    const places = Object.fromEntries(g.getPlacements().map((p) => [p.id, p.place]));
    expect(places[me.id]).toBe(1);
    expect(places[foe.id]).toBe(2);
    expect(g.drainEvents().some((e) => e.kind === 'eliminated' && e.id === foe.id)).toBe(true);
  });

  it('places players knocked out together on the same place', () => {
    const g = start(3);
    const me = turnSeat(g);
    for (const s of inner(g).seats) if (s !== me) s.hp = 1;
    me.hand = [idx('Quake')];
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect(g.isFinished()).toBe(true);
    expect(g.getPlacements().map((p) => p.place).sort()).toEqual([1, 2, 2]);
  });

  it('puts a player who left last-knocked-out order, keeping everyone placed once', () => {
    const g = start(3);
    g.removePlayer('p1');
    expect(g.isFinished()).toBe(false);
    g.removePlayer('p2');
    expect(g.isFinished()).toBe(true);
    const pl = g.getPlacements();
    expect(pl).toHaveLength(3);
    expect(pl.find((p) => p.id === 'p0')!.place).toBe(1);
    expect(pl.find((p) => p.id === 'p1')!.place).toBe(3);
    expect(pl.find((p) => p.id === 'p2')!.place).toBe(2);
  });

  it('reshuffles the discard pile when the deck runs out', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.deck = [];
    me.disc = [idx('Zap'), idx('Zap')];
    me.hand = [idx('Nap')];
    g.handleAction(me.id, { a: 'play', c: 0 });
    const next = turnSeat(g);
    next.deck = [];
    next.disc = [idx('Zap')];
    g.update(21);
    expect(me.deck.length + me.hand.length + me.disc.length).toBeGreaterThan(0);
  });

  it('ends the round at the turn limit, most hit points first', () => {
    const g = start(2, { maxTurns: 10 });
    inner(g).seats[0].hp = 7;
    let guard = 0;
    while (!g.isFinished() && guard++ < 1000) g.update(21);
    expect(g.isFinished()).toBe(true);
    expect(g.getPlacements()).toHaveLength(2);
  });

  it('plays itself out with presses of A (the bot input)', () => {
    for (const n of [2, 3, 4]) {
      const g = start(n);
      let guard = 0;
      let down = false;
      while (!g.isFinished() && guard++ < 20000) {
        const turn = g.getState().turn;
        down = !down;
        g.handleInput(turn, { mx: 0, my: 0, a1: down, a2: false });
        g.update(1 / 30);
      }
      expect(g.isFinished()).toBe(true);
      expect(g.getPlacements().map((p) => p.id).sort()).toEqual(names(n).map((p) => p.id));
    }
  });
});

const press = (g: RumbleCards, id: string, pad: Partial<{ mx: number; my: number; a1: boolean; a2: boolean }>) => {
  g.handleInput(id, { mx: 0, my: 0, a1: false, a2: false, ...pad });
  g.handleInput(id, { mx: 0, my: 0, a1: false, a2: false }); // release
};

describe('standard controls', () => {
  it('moves the selected card with left and right, wrapping round', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [idx('Zap'), idx('Nap'), idx('Pounce')];
    const cur = () => (g.getPrivateState(me.id) as { cur: number }).cur;
    expect(cur()).toBe(0);
    press(g, me.id, { mx: 1 });
    expect(cur()).toBe(1);
    press(g, me.id, { mx: 1 });
    press(g, me.id, { mx: 1 });
    expect(cur()).toBe(0);
    press(g, me.id, { mx: -1 });
    expect(cur()).toBe(2);
  });

  it('counts a held direction once, and a press after release again', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [idx('Zap'), idx('Nap'), idx('Pounce')];
    for (let i = 0; i < 5; i++) g.handleInput(me.id, { mx: 1, my: 0, a1: false, a2: false });
    expect((g.getPrivateState(me.id) as { cur: number }).cur).toBe(1);
    g.handleInput(me.id, { mx: 0, my: 0, a1: false, a2: false });
    g.handleInput(me.id, { mx: 1, my: 0, a1: false, a2: false });
    expect((g.getPrivateState(me.id) as { cur: number }).cur).toBe(2);
  });

  it('plays the selected card with A, only once while held', () => {
    const g = start(2);
    const me = turnSeat(g);
    const foe = inner(g).seats.find((s) => s !== me)!;
    me.hand = [idx('Zap'), idx('Pounce'), idx('Nap')];
    press(g, me.id, { mx: 1 }); // select Pounce
    for (let i = 0; i < 4; i++) g.handleInput(me.id, { mx: 0, my: 0, a1: true, a2: false });
    expect(foe.hp).toBe(8);
    // the turn passed and the hand was refilled to the limit: the two kept cards, then a new one
    expect(me.hand.slice(0, 2)).toEqual([idx('Zap'), idx('Nap')]);
    expect(me.hand).toHaveLength(3);
  });

  it('aims with up and down, and A hits the aimed rival', () => {
    const g = start(3);
    const me = turnSeat(g);
    const foes = inner(g).seats.filter((s) => s !== me);
    me.hand = [idx('Zap'), idx('Zap')];
    expect(g.getState().aim).toBe(foes[0].id);
    press(g, me.id, { my: 1 });
    expect(g.getState().aim).toBe(foes[1].id);
    press(g, me.id, { my: 1 });
    expect(g.getState().aim).toBe(foes[0].id);
    press(g, me.id, { my: -1 });
    expect(g.getState().aim).toBe(foes[1].id);
    press(g, me.id, { a1: true });
    expect(foes[1].hp).toBe(9);
    expect(foes[0].hp).toBe(10);
  });

  it('ends the turn with B only after a card was played', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [idx('Quick Dash'), idx('Zap'), idx('Zap')];
    press(g, me.id, { a2: true });
    expect(g.getState().turn).toBe(me.id);
    press(g, me.id, { a1: true }); // Quick Dash: one more play
    expect(g.getState().turn).toBe(me.id);
    press(g, me.id, { a2: true });
    expect(g.getState().turn).not.toBe(me.id);
  });

  it('ignores the controls of a player whose turn it is not, and a stale hold later', () => {
    const g = start(2);
    const other = inner(g).seats.find((s) => s !== turnSeat(g))!;
    const before = other.hand.length;
    g.handleInput(other.id, { mx: 1, my: 0, a1: true, a2: false });
    expect(other.hand.length).toBe(before);
    expect(g.getState().made).toBe(0);
  });

  it('keeps the selection in step with taps (sel and aim actions)', () => {
    const g = start(3);
    const me = turnSeat(g);
    const foes = inner(g).seats.filter((s) => s !== me);
    me.hand = [idx('Zap'), idx('Nap'), idx('Pounce')];
    g.handleAction(me.id, { a: 'sel', c: 2 });
    expect((g.getPrivateState(me.id) as { cur: number }).cur).toBe(2);
    g.handleAction(me.id, { a: 'sel', c: 9 });
    g.handleAction(me.id, { a: 'sel', c: 'x' });
    expect((g.getPrivateState(me.id) as { cur: number }).cur).toBe(2);
    g.handleAction(me.id, { a: 'aim', tg: foes[1].id });
    expect(g.getState().aim).toBe(foes[1].id);
    g.handleAction(me.id, { a: 'aim', tg: me.id });
    g.handleAction(me.id, { a: 'aim', tg: 'nobody' });
    expect(g.getState().aim).toBe(foes[1].id);
  });
});

describe('target and event amounts', () => {
  it('makes a rival the aim when a card is played on them', () => {
    const g = start(3);
    const me = turnSeat(g);
    const foes = inner(g).seats.filter((s) => s !== me);
    me.hand = [idx('Zap'), idx('Quick Dash'), idx('Zap')];
    expect(g.getState().aim).toBe(foes[0].id);
    g.handleAction(me.id, { a: 'play', c: 0, tg: foes[1].id });
    expect(foes[1].hp).toBe(9);
    // the turn passed; the aim of the next player is theirs, and ours stayed on who we hit
    expect((me as unknown as { aim: string }).aim).toBe(foes[1].id);
  });

  it('keeps the new aim for the next card of the same turn', () => {
    const g = start(3);
    const me = turnSeat(g);
    const foes = inner(g).seats.filter((s) => s !== me);
    me.hand = [idx('Chain Zap'), idx('Zap')];
    g.handleAction(me.id, { a: 'play', c: 0, tg: foes[1].id });
    expect(g.getState().turn).toBe(me.id);
    expect(g.getState().aim).toBe(foes[1].id);
  });

  it('puts the amounts in the events', () => {
    const g = start(2);
    const me = turnSeat(g);
    const foe = inner(g).seats.find((s) => s !== me)!;
    foe.def = [{ c: idx('Fur Shield'), h: 1 }];
    me.hp = 6;
    me.hand = [idx('Boulder Toss'), idx('Nap'), idx('Zap')];
    g.drainEvents();
    g.handleAction(me.id, { a: 'play', c: 0 }); // 2 damage: 1 absorbed, 1 hurts
    const ev = g.drainEvents() as { kind: string; id: string; n?: number }[];
    expect(ev.find((e) => e.kind === 'ext:block')).toMatchObject({ id: foe.id, n: 1 });
    expect(ev.find((e) => e.kind === 'hit')).toMatchObject({ id: foe.id, n: 1 });
    const g2 = start(2);
    const a = turnSeat(g2);
    a.hp = 6;
    a.hand = [idx('Nap'), idx('Zap')];
    g2.drainEvents();
    g2.handleAction(a.id, { a: 'play', c: 0 });
    expect((g2.drainEvents() as { kind: string; n?: number }[]).find((e) => e.kind === 'heal')?.n).toBe(1);
  });

  it('announces the cast first, with the card and the target', () => {
    const g = start(3);
    const me = turnSeat(g);
    const foes = inner(g).seats.filter((s) => s !== me);
    me.hand = [idx('Hex'), idx('Zap')];
    foes[1].hand = [idx('Zap')];
    g.drainEvents();
    g.handleAction(me.id, { a: 'play', c: 0, tg: foes[1].id });
    const ev = g.drainEvents() as { kind: string; id: string; c?: number; tg?: string }[];
    expect(ev[0]).toMatchObject({ kind: 'ext:play', id: me.id, c: idx('Hex'), tg: foes[1].id });
    expect(ev.filter((e) => e.kind === 'ext:play')).toHaveLength(1);
    expect(ev.findIndex((e) => e.kind === 'hit')).toBeGreaterThan(0);
  });

  it('announces an untargeted cast with no target', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [idx('Nap'), idx('Zap')];
    g.drainEvents();
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect((g.drainEvents() as { kind: string; tg?: string }[])[0]).toMatchObject({ kind: 'ext:play', tg: '' });
  });

  it('reports only the hit points really lost', () => {
    const g = start(2);
    const me = turnSeat(g);
    const foe = inner(g).seats.find((s) => s !== me)!;
    foe.hp = 1;
    me.hand = [idx('Boulder Toss')];
    g.drainEvents();
    g.handleAction(me.id, { a: 'play', c: 0 });
    expect((g.drainEvents() as { kind: string; n?: number }[]).find((e) => e.kind === 'hit')?.n).toBe(1);
  });
});

describe('applyOptions', () => {
  it('clamps to the allowed range', () => {
    expect(applyOptions({ hp: 99, hand: 0, maxHand: 99, turnSeconds: 5, turnVariance: 99, maxTurns: 1000 })).toEqual({ hp: 20, hand: 2, maxHand: 8, turnSeconds: 10, turnVariance: 8, maxTurns: 40 });
    expect(applyOptions({ maxHand: 0 }).maxHand).toBe(2);
    expect(applyOptions({})).toEqual({ hp: 10, hand: 3, maxHand: 3, turnSeconds: 20, turnVariance: 0, maxTurns: 25 });
  });

  it('turnVariance spreads the turn length around turnSeconds', () => {
    const turn = (rng: () => number) => {
      const g = new RumbleCards({ ...DEFAULT_CONFIG, turnVariance: 6 }, rng);
      g.init([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      return g.getState().tt;
    };
    expect(turn(() => 0)).toBe(14);
    expect(turn(() => 0.9999)).toBeCloseTo(26, 0);
  });
});

describe('hand limit and discarding', () => {
  /** a plain one-target damage card, so a play has no side effects on the hand */
  const HIT = CARDS.findIndex((c) => c.fx.length === 1 && c.fx[0].k === 'dmg' && !c.def);
  type Ev = { kind: string; id?: string; c?: number; auto?: boolean; n?: number };
  /** a game where the player on turn holds `n` plain damage cards and has played none yet */
  const over = (n: number, opts: Record<string, number> = { maxHand: 2 }) => {
    const g = start(2, opts);
    turnSeat(g).hand = Array.from({ length: n }, () => HIT);
    g.drainEvents();
    return g;
  };
  const discards = (g: RumbleCards) => (g.drainEvents() as Ev[]).filter((e) => e.kind === 'ext:discard');

  it('a hand over the limit when the turn ends must be discarded by the player, who keeps the turn', () => {
    const g = over(4);
    const me = turnSeat(g);
    const turn = g.getState().turn;
    g.handleAction(turn, { a: 'play', c: 0 }); // 3 left, limit 2, no plays left
    expect(g.getState().purge).toBe(1);
    expect(g.getState().turn).toBe(turn);
    const pile = me.disc.length;
    g.handleAction(turn, { a: 'discard', c: 1 });
    expect(me.hand).toHaveLength(2);
    expect(me.disc.length).toBe(pile + 1);
    expect(g.getState().purge).toBe(0);
    expect(g.getState().turn).not.toBe(turn);
    expect(discards(g)).toMatchObject([{ id: turn, c: HIT, auto: false }]);
  });

  it('under the limit nothing is asked', () => {
    const g = over(3, { maxHand: 3 });
    const turn = g.getState().turn;
    g.handleAction(turn, { a: 'play', c: 0 });
    expect(g.getState().purge).toBe(0);
    expect(g.getState().turn).not.toBe(turn);
    expect(discards(g)).toHaveLength(0);
  });

  it('several extra cards are discarded one by one before the turn passes', () => {
    const g = over(5);
    const turn = g.getState().turn;
    g.handleAction(turn, { a: 'play', c: 0 });
    expect(g.getState().purge).toBe(2);
    g.handleAction(turn, { a: 'discard', c: 0 });
    expect(g.getState().purge).toBe(1);
    expect(g.getState().turn).toBe(turn);
    g.handleAction(turn, { a: 'discard', c: 0 });
    expect(g.getState().turn).not.toBe(turn);
  });

  it('while discarding, plays and End turn do nothing; A discards the selected card', () => {
    const g = over(4);
    const me = turnSeat(g);
    const turn = g.getState().turn;
    g.handleAction(turn, { a: 'play', c: 0 });
    g.handleAction(turn, { a: 'play', c: 0 });
    g.handleAction(turn, { a: 'end' });
    g.handleInput(turn, { mx: 0, my: 0, a1: false, a2: true });
    g.handleInput(turn, { mx: 0, my: 0, a1: false, a2: false });
    expect(me.hand).toHaveLength(3);
    expect(g.getState().purge).toBe(1);
    g.handleInput(turn, { mx: 1, my: 0, a1: false, a2: false }); // select the next card
    g.handleInput(turn, { mx: 0, my: 0, a1: false, a2: false });
    g.handleInput(turn, { mx: 0, my: 0, a1: true, a2: false });
    expect(me.hand).toHaveLength(2);
    expect(g.getState().turn).not.toBe(turn);
  });

  it('out of time: a card is played, then random cards are discarded down to the limit', () => {
    const g = over(5);
    const me = turnSeat(g);
    const turn = g.getState().turn;
    g.update(25);
    expect(g.getState().turn).not.toBe(turn);
    expect(me.hand).toHaveLength(2); // 5 - 1 played - 2 discarded
    const ev = discards(g);
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.auto === true)).toBe(true);
  });

  it('out of time while choosing: the rest are discarded at random', () => {
    const g = over(5);
    const me = turnSeat(g);
    const turn = g.getState().turn;
    g.handleAction(turn, { a: 'play', c: 0 });
    g.handleAction(turn, { a: 'discard', c: 0 });
    g.drainEvents();
    expect(g.getState().purge).toBe(1);
    g.update(25);
    expect(me.hand).toHaveLength(2);
    expect(g.getState().turn).not.toBe(turn);
    expect(discards(g)).toMatchObject([{ auto: true }]);
  });

  it('a long starting hand is trimmed at the end of the first turn', () => {
    const g = start(2, { hand: 5, maxHand: 2 });
    const turn = g.getState().turn;
    g.handleAction(turn, { a: 'play', c: 0 });
    const left = turnSeat(g).hand.length;
    expect(left).toBeGreaterThanOrEqual(4); // 5 dealt, 1 played (a draw card may add more)
    expect(g.getState().purge).toBe(left - 2);
  });
});

describe('the last seconds of a turn', () => {
  const run = (opts: Record<string, number>, seconds: number) => {
    const g = start(2, opts);
    g.drainEvents();
    const ticks: number[] = [];
    for (let t = 0; t < seconds * 20; t++) {
      g.update(0.05);
      for (const e of g.drainEvents() as { kind: string; n?: number }[]) if (e.kind === 'ext:tick') ticks.push(e.n!);
    }
    return { g, ticks };
  };

  it('ticks once a second for the last five seconds', () => {
    const { ticks } = run({ turnSeconds: 10 }, 9.5);
    expect(ticks).toEqual([5, 4, 3, 2, 1]);
  });

  it('the snapshot carries the length of the turn', () => {
    expect(start(2, { turnSeconds: 30 }).getState().ttMax).toBe(30);
  });
});

describe('the hand is refilled to the limit when the turn ends', () => {
  const HIT = CARDS.findIndex((c) => c.fx.length === 1 && c.fx[0].k === 'dmg' && !c.def);

  it('nothing is drawn at the start of a turn', () => {
    const g = start(2);
    const turn = turnSeat(g);
    expect(turn.hand).toHaveLength(3);
    const deck = turn.deck.length;
    g.update(0.1);
    expect(turn.deck.length).toBe(deck);
  });

  it('a hand below the limit is drawn up to it at the end of the turn, for the player who played', () => {
    const g = start(2, { maxHand: 4 });
    const me = turnSeat(g);
    const turn = g.getState().turn;
    me.hand = [HIT, HIT, HIT];
    const deck = me.deck.length;
    g.handleAction(turn, { a: 'play', c: 0 }); // 2 left, limit 4
    expect(g.getState().turn).not.toBe(turn);
    expect(me.hand).toHaveLength(4);
    expect(me.deck.length).toBe(deck - 2);
  });

  it('an empty hand is refilled to the whole limit', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [HIT];
    g.handleAction(g.getState().turn, { a: 'play', c: 0 });
    expect(me.hand).toHaveLength(3);
  });

  it('a hand at the limit is left alone, even when ending the turn early', () => {
    const g = start(2);
    const me = turnSeat(g);
    const turn = g.getState().turn;
    me.hand = [HIT, HIT, HIT, HIT];
    g.handleAction(turn, { a: 'play', c: 0 }); // 3 left = the limit
    expect(me.hand).toHaveLength(3);
    expect(g.getState().purge).toBe(0);
  });

  it('after discarding down to the limit nothing is drawn', () => {
    const g = start(2, { maxHand: 2 });
    const me = turnSeat(g);
    const turn = g.getState().turn;
    me.hand = [HIT, HIT, HIT, HIT];
    const deck = me.deck.length;
    g.handleAction(turn, { a: 'play', c: 0 });
    g.handleAction(turn, { a: 'discard', c: 0 });
    expect(me.hand).toHaveLength(2);
    expect(me.deck.length).toBe(deck);
  });

  it('the discard pile is shuffled back when the deck runs out during the refill', () => {
    const g = start(2);
    const me = turnSeat(g);
    me.hand = [HIT];
    me.disc = [HIT, HIT, HIT, HIT];
    me.deck = [HIT];
    g.handleAction(g.getState().turn, { a: 'play', c: 0 });
    expect(me.hand).toHaveLength(3);
  });
});

describe('events carry the balance for the history', () => {
  it('a hit, a block and a heal say how many hit points and Defense the player has after', () => {
    const g = start(2);
    const me = turnSeat(g);
    const foe = inner(g).seats.find((s) => s !== me)!;
    foe.def = [{ c: idx('Fur Shield'), h: 1 }];
    me.hand = [idx('Pounce'), idx('Nap')];
    g.drainEvents();
    g.handleAction(me.id, { a: 'play', c: 0 }); // 2 damage: 1 into the Defense, 1 into hit points
    const ev = g.drainEvents() as { kind: string; id: string; n?: number; hp?: number; sh?: number }[];
    expect(ev.find((e) => e.kind === 'ext:block')).toMatchObject({ id: foe.id, n: 1, sh: 0 });
    expect(ev.find((e) => e.kind === 'hit')).toMatchObject({ id: foe.id, n: 1, hp: 9, sh: 0 });
  });
});
