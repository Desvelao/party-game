import { describe, expect, it } from 'vitest';
import { CARDS } from '../shared/cards';
import { along, angleToward, approach, ease, effectFor, cometPath, damageOf, newCards, timerFraction, timerTone } from './anim';

const idx = (n: string) => CARDS.findIndex((c) => c.name === n);

describe('newCards', () => {
  it('marks nothing when the hand is unchanged or only lost cards', () => {
    expect(newCards([1, 2, 3], [1, 2, 3])).toEqual([false, false, false]);
    expect(newCards([1, 2, 3], [1, 3])).toEqual([false, false]);
  });
  it('marks drawn cards, even a second copy of a card already held', () => {
    expect(newCards([1, 2], [1, 2, 3])).toEqual([false, false, true]);
    expect(newCards([1, 2], [1, 2, 1])).toEqual([false, false, true]);
    expect(newCards([], [4, 5])).toEqual([true, true]);
  });
  it('copes with a card played and another drawn in one update', () => {
    expect(newCards([1, 2, 3], [2, 3, 9])).toEqual([false, false, true]);
  });
});

describe('ease and along', () => {
  it('ease runs from 0 to 1 and is clamped', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-3)).toBe(0);
    expect(ease(7)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });
  it('along starts at from, ends at to, and bows in between', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    expect(along(a, b, 0, 40)).toEqual({ x: 0, y: 0 });
    const end = along(a, b, 1, 40);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(0);
    const mid = along(a, b, 0.5, 40);
    expect(mid.x).toBeCloseTo(50);
    expect(Math.abs(mid.y)).toBeCloseTo(40);
    expect(along(a, a, 0.5, 40)).toBeDefined();
  });
});

describe('effectFor', () => {
  it('picks an effect kind that fits the card', () => {
    expect(effectFor(idx('Zap')).kind).toBe('shot');
    expect(effectFor(idx('Nap')).kind).toBe('heal');
    expect(effectFor(idx('Burrow Wall')).kind).toBe('guard');
    expect(effectFor(idx('Quake')).kind).toBe('wave');
    expect(effectFor(idx('Hex')).kind).toBe('steal');
    expect(effectFor(idx('Shatter')).kind).toBe('smash');
    expect(effectFor(idx('Quick Dash')).kind).toBe('draw');
  });
  it('gives every card a kind and a colour', () => {
    CARDS.forEach((c, i) => {
      const e = effectFor(i);
      expect(e.kind, c.name).toBeTruthy();
      expect(e.color, c.name).toBeGreaterThan(0);
    });
  });
});

describe('angleToward', () => {
  const o = { x: 0, y: 0 };
  it('points right, down, left and up', () => {
    expect(angleToward(o, { x: 5, y: 0 })).toBeCloseTo(0);
    expect(angleToward(o, { x: 0, y: 5 })).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(angleToward(o, { x: -5, y: 0 }))).toBeCloseTo(Math.PI);
    expect(angleToward(o, { x: 0, y: -5 })).toBeCloseTo(-Math.PI / 2);
  });
});

describe('approach', () => {
  it('moves by at most the step and arrives exactly', () => {
    expect(approach(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(approach(0.5, 1, 0.5)).toBe(1);
    expect(approach(0, 1, 5)).toBe(1);
    expect(approach(2, 2, 0.3)).toBe(2);
  });
  it('turns the short way, also across the +-PI seam', () => {
    expect(approach(3, -3, 0.1)).toBeCloseTo(3.1); // 3 -> -3 is a short hop through PI, not a long way round
    expect(approach(-3, 3, 0.1)).toBeCloseTo(-3.1);
    expect(approach(0, -2, 0.5)).toBeCloseTo(-0.5);
  });
  it('does not move with a zero step', () => {
    expect(approach(1, 2, 0)).toBe(1);
  });
});

describe('the turn timer', () => {
  it('is calm, then warns, then urgent in the last 5 seconds', () => {
    expect(timerTone(18, 20)).toBe('ok');
    expect(timerTone(9, 20)).toBe('warn');
    expect(timerTone(5, 20)).toBe('urgent');
    expect(timerTone(0.2, 20)).toBe('urgent');
  });

  it('a short turn warns earlier in proportion', () => {
    expect(timerTone(9, 12)).toBe('ok');
    expect(timerTone(4.5, 12)).toBe('urgent');
    expect(timerTone(6, 12)).toBe('warn');
  });

  it('the ring follows the length of this turn, not a fixed 60 s', () => {
    expect(timerFraction(10, 20)).toBe(0.5);
    expect(timerFraction(30, 20)).toBe(1);
    expect(timerFraction(-1, 20)).toBe(0);
    expect(timerFraction(30, 0)).toBe(0.5);
  });
});

describe('damageOf', () => {
  it('tells single-target damage from hit-everyone, and finds the damage of mixed cards', () => {
    expect(damageOf(idx('Zap'))).toEqual({ single: true, all: false });
    expect(damageOf(idx('Quake'))).toEqual({ single: false, all: true });
    expect(damageOf(idx('Hex')).single).toBe(true); // damage and steal
    expect(damageOf(idx('Shatter')).single).toBe(true); // damage and smash
    expect(damageOf(idx('Nap'))).toEqual({ single: false, all: false });
    expect(damageOf(idx('Fur Shield'))).toEqual({ single: false, all: false });
  });
});

describe('cometPath', () => {
  it('runs from the caster to the target along a bowed arc', () => {
    const path = cometPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 40);
    expect(path).toHaveLength(11);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[10].x).toBeCloseTo(100);
    expect(Math.abs(path[5].y)).toBeGreaterThan(10); // bowed away from the straight line
    expect(Math.abs(path[10].y)).toBeLessThan(0.001);
    for (let i = 1; i < path.length; i++) expect(path[i].x).toBeGreaterThanOrEqual(path[i - 1].x);
  });
});
