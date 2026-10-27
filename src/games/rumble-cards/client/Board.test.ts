import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientContext } from '../../../core/client/src/plugins/api';
import { CARDS } from '../shared/cards';
import plugin from './index';
import { resetTiming } from './timing';

const idx = (n: string) => CARDS.findIndex((c) => c.name === n);

/** a Phaser graphics stand-in that counts what was drawn */
function fakeGraphics() {
  const calls: string[] = [];
  const g: unknown = new Proxy({}, { get: (_t, k) => (..._a: unknown[]) => (calls.push(String(k)), g) });
  return { g, calls };
}

let T = 1000;
function setup(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
  vi.spyOn(performance, 'now').mockImplementation(() => T);
  T = 1000;
  resetTiming();
  const ctx = { sound() {}, drawCharacter() {}, labelOf: (i: string) => i, tr: (s: string) => s, myId: () => 'a' } as unknown as ClientContext;
  const fx = { burst() {}, shake() {} };
  const r = plugin.createRenderer(ctx);
  r.reset?.();
  const state = {
    kind: 'ext:rumble-cards', t: 1, turn: 'a', aim: 'b', tt: 10, ttMax: 20, purge: 0, made: 1, left: 1, last: null,
    players: ['a', 'b', 'c'].map((id, i) => ({ id, hero: i, hp: 10, maxHp: 10, hand: 3, deck: 10, disc: 0, def: [], out: false })),
  };
  const host = { g: null as unknown, label: () => ({ setPosition() {} }) };
  const cast = (card: string, tg: string) => plugin.event!({ kind: 'ext:play', id: 'a', c: idx(card), tg, x: 0, y: 0 } as never, fx as never, ctx);
  const frame = (at: number) => {
    T = 1000 + at;
    const { g, calls } = fakeGraphics();
    host.g = g;
    r.render(host as never, state as never, state as never, state as never, 1);
    return calls;
  };
  return { cast, frame };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the damage effect on the table', () => {
  it('flies a big comet to the target, then bursts on it', () => {
    const { cast, frame } = setup(false);
    cast('Pounce', 'b');
    frame(0); // the first frame after a cast starts its effect
    const n = (calls: string[], what: string) => calls.filter((c) => c === what).length;
    // frames in time order: an effect that has ended is dropped for good
    const flight = frame(200);
    const hit = frame(800);
    const idle = frame(2000);
    expect(n(flight, 'fillCircle')).toBeGreaterThan(n(idle, 'fillCircle') + 8);
    expect(n(hit, 'strokeCircle')).toBeGreaterThan(n(idle, 'strokeCircle'));
    expect(n(hit, 'lineBetween')).toBeGreaterThan(n(idle, 'lineBetween')); // the sparks
  });

  it('a hit-everyone card sends one to every rival', () => {
    const { cast, frame } = setup(false);
    cast('Quake', '');
    frame(0);
    const one = setup(false);
    one.cast('Pounce', 'b');
    one.frame(0);
    expect(frame(200).filter((c) => c === 'fillCircle').length).toBeGreaterThan(one.frame(200).filter((c) => c === 'fillCircle').length + 8);
  });

  it('with reduced motion it is still shown: a still line and a flash that only fade', () => {
    const { cast, frame } = setup(true);
    cast('Pounce', 'b');
    frame(0);
    const n = (calls: string[], what: string) => calls.filter((c) => c === what).length;
    const mid = frame(300);
    const idle = frame(2000);
    expect(n(mid, 'lineBetween')).toBeGreaterThan(n(idle, 'lineBetween'));
    expect(n(mid, 'fillCircle')).toBeGreaterThan(n(idle, 'fillCircle'));
    expect(frame(2100)).toHaveLength(idle.length);
  });

  it('Hex (steal and damage) shows the hit too', () => {
    const { cast, frame } = setup(true);
    cast('Hex', 'b');
    frame(0);
    const mid = frame(300);
    const idle = frame(2000);
    expect(mid.filter((c) => c === 'lineBetween').length).toBeGreaterThan(idle.filter((c) => c === 'lineBetween').length);
  });
});
