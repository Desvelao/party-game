import { afterEach, describe, expect, it } from 'vitest';
import { fireComets, setCometSink, targetsOf, type CometCast } from './comets';

const players = [
  { id: 'a', out: false },
  { id: 'b', out: false },
  { id: 'c', out: false },
  { id: 'd', out: true },
];
const cast = (over: Partial<CometCast> = {}): CometCast => ({ single: true, all: false, p: 'a', tg: 'b', color: 0xff0000, ...over });

afterEach(() => setCometSink(null));

describe('targetsOf', () => {
  it('a single-target card goes to the aimed rival', () => {
    expect(targetsOf(cast(), players)).toEqual(['b']);
    expect(targetsOf(cast({ tg: 'c' }), players)).toEqual(['c']);
  });

  it('a hit-everyone card goes to every rival still in, never the caster', () => {
    expect(targetsOf(cast({ single: false, all: true, tg: '' }), players)).toEqual(['b', 'c']);
  });

  it('with one rival left an unaimed card still goes to them; with several it goes nowhere', () => {
    expect(targetsOf(cast({ tg: '' }), [{ id: 'a', out: false }, { id: 'b', out: false }])).toEqual(['b']);
    expect(targetsOf(cast({ tg: '' }), players)).toEqual([]);
  });

  it('never aims at an eliminated player or the caster', () => {
    expect(targetsOf(cast({ tg: 'd' }), players)).toEqual([]);
    expect(targetsOf(cast({ tg: 'a' }), players)).toEqual([]);
  });

  it('a card without direct damage reaches nobody', () => {
    expect(targetsOf(cast({ single: false, all: false }), players)).toEqual([]);
  });
});

describe('the comet sink', () => {
  it('is only called while a player\'s controls have registered it', () => {
    const seen: CometCast[] = [];
    fireComets(cast()); // the table: nothing registered, nothing happens
    setCometSink((c) => seen.push(c));
    fireComets(cast());
    setCometSink(null);
    fireComets(cast());
    expect(seen).toHaveLength(1);
  });
});
