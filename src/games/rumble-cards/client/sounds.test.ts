import { describe, expect, it } from 'vitest';
import { sanitizeSound } from '../../../core/client/src/audio/recipe';
import { CARDS } from '../shared/cards';
import { BLOCK, BREAK, CAST, DISCARD, DISCARD_AUTO, HEAL_CHIME, KNOCK_OUT, UI, castSound, hitSound, tickSound } from './sounds';

/** a recipe is valid when sanitizing changes none of the values it spells out */
function untouched(name: string, steps: object[]): void {
  const out = sanitizeSound(steps) as object[];
  expect(out, name).toHaveLength(steps.length);
  steps.forEach((s, i) => {
    for (const [k, v] of Object.entries(s)) expect((out[i] as Record<string, unknown>)[k], `${name}[${i}].${k}`).toEqual(v);
  });
}

const total = (steps: { g?: number }[]) => steps.reduce((a, s) => a + (s.g ?? 0), 0);

describe('sounds', () => {
  it('every recipe is within the core limits (nothing gets clamped)', () => {
    for (const [name, steps] of Object.entries(CAST)) untouched(`cast ${name}`, steps);
    for (const k of [1, 2, 3]) untouched(`hit ${k}`, hitSound(k));
    untouched('block', BLOCK);
    untouched('break', BREAK);
    untouched('heal', HEAL_CHIME);
    untouched('ko', KNOCK_OUT);
    untouched('discard', DISCARD);
    untouched('discard auto', DISCARD_AUTO);
    for (const n of [1, 2, 3, 4, 5]) untouched(`tick ${n}`, tickSound(n));
    for (const [name, steps] of Object.entries(UI)) untouched(`ui ${name}`, steps);
  });

  it('every card has a cast sound', () => {
    CARDS.forEach((c, i) => expect(castSound(i).length, c.name).toBeGreaterThan(0));
  });

  it('different effects sound different', () => {
    const idx = (n: string) => CARDS.findIndex((c) => c.name === n);
    const sig = (n: string) => JSON.stringify(castSound(idx(n)));
    const names = ['Zap', 'Dig Claw', 'Boulder Toss', 'Comet Strike', 'Hex', 'Nap', 'Burrow Wall', 'Quake', 'Shatter', 'Quick Dash'];
    expect(new Set(names.map(sig)).size).toBe(names.length);
    // damage cards follow their illustration: a bolt is not a paw, and a rock is not a comet
    expect(sig('Zap')).not.toBe(sig('Pounce'));
    expect(sig('Pounce')).not.toBe(sig('Boulder Toss'));
  });

  it('the ticks climb as the time runs out, and the last one is a double', () => {
    const g = (n: number) => (tickSound(n)[0] as { g: number }).g;
    const f = (n: number) => (tickSound(n)[0] as { f: number }).f;
    for (let n = 5; n > 1; n--) {
      expect(f(n - 1)).toBeGreaterThan(f(n));
      expect(g(n - 1)).toBeGreaterThan(g(n));
    }
    expect(tickSound(1)).toHaveLength(2);
    expect(tickSound(5)).toHaveLength(1);
    expect(JSON.stringify(DISCARD)).not.toBe(JSON.stringify(DISCARD_AUTO));
  });

  it('heavier hits are louder and last longer', () => {
    expect(total(hitSound(3))).toBeGreaterThan(total(hitSound(2)));
    expect(total(hitSound(2))).toBeGreaterThan(total(hitSound(1)));
    expect(JSON.stringify(hitSound(1))).not.toBe(JSON.stringify(hitSound(3)));
    expect(JSON.stringify(hitSound(7))).toBe(JSON.stringify(hitSound(3))); // beyond 3 is as heavy as it gets
  });
});
