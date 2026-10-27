import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientContext, SoundStep } from '../../../core/client/src/plugins/api';
import { CARDS } from '../shared/cards';
import { resetTiming } from './timing';
import { BLOCK, BREAK, HEAL_CHIME, KNOCK_OUT, castSound, hitSound } from './sounds';
import plugin from './index';

const idx = (n: string) => CARDS.findIndex((c) => c.name === n);

function setup() {
  const played: { steps: SoundStep[]; at: number }[] = [];
  const bursts: number[] = [];
  const ctx = { sound: (steps: SoundStep[]) => played.push({ steps, at: performance.now() }), sfx: () => {} } as unknown as ClientContext;
  const fx = { burst: () => bursts.push(performance.now()), shake: () => {} };
  const event = (e: Record<string, unknown>) => plugin.event!({ x: 100, y: 100, ...e } as never, fx, ctx);
  return { played, bursts, event };
}

describe('sounds follow the effect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTiming();
  });
  afterEach(() => vi.useRealTimers());

  it('plays the cast sound of the card at once', () => {
    const { played, event } = setup();
    expect(event({ kind: 'ext:play', id: 'a', c: idx('Zap'), tg: 'b' })).toBe(true);
    expect(played).toHaveLength(1);
    expect(played[0].steps).toEqual(castSound(idx('Zap')));
  });

  it('gives different cards different sounds', () => {
    const { played, event } = setup();
    for (const n of ['Zap', 'Boulder Toss', 'Nap', 'Burrow Wall', 'Quake', 'Hex', 'Shatter', 'Quick Dash']) event({ kind: 'ext:play', id: 'a', c: idx(n), tg: '' });
    expect(new Set(played.map((p) => JSON.stringify(p.steps))).size).toBe(8);
  });

  it('holds back the impact of a thrown card until it lands, with the cast first', () => {
    const { played, bursts, event } = setup();
    event({ kind: 'ext:play', id: 'a', c: idx('Zap'), tg: 'b' });
    event({ kind: 'hit', id: 'b', n: 2 });
    expect(played).toHaveLength(1); // only the cast so far
    expect(bursts).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(played).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(played).toHaveLength(2);
    expect(played[1].steps).toEqual(hitSound(2));
    expect(bursts).toHaveLength(1);
  });

  it('a card that steals as well as hits waits for its comet too', () => {
    const { played, event } = setup();
    event({ kind: 'ext:play', id: 'a', c: idx('Hex'), tg: 'b' });
    event({ kind: 'hit', id: 'b', n: 1 });
    vi.advanceTimersByTime(500);
    expect(played).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(played).toHaveLength(2);
  });

  it('a heal or a Defense card still lands at once', () => {
    const { played, event } = setup();
    event({ kind: 'ext:play', id: 'a', c: idx('Nap'), tg: '' });
    event({ kind: 'heal', id: 'a', n: 1 });
    expect(played).toHaveLength(2);
  });

  it('lands an all-foes card when its comets arrive, like a thrown one', () => {
    const { played, event } = setup();
    event({ kind: 'ext:play', id: 'a', c: idx('Quake'), tg: '' });
    event({ kind: 'hit', id: 'b', n: 1 });
    vi.advanceTimersByTime(500);
    expect(played).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(played).toHaveLength(2);
  });

  it('plays a heal at once when nothing was cast just before', () => {
    const { played, event } = setup();
    event({ kind: 'heal', id: 'a', n: 1 });
    expect(played).toHaveLength(1);
    expect(played[0].steps).toEqual(HEAL_CHIME);
  });

  it('uses a heavier sound for a bigger hit, and the right ones for block, break and knock-out', () => {
    const { played, event } = setup();
    event({ kind: 'hit', id: 'a', n: 1 });
    event({ kind: 'hit', id: 'a', n: 3 });
    event({ kind: 'ext:block', id: 'a', n: 1 });
    event({ kind: 'ext:break', id: 'a' });
    event({ kind: 'eliminated', id: 'a' });
    expect(played.map((p) => p.steps)).toEqual([hitSound(1), hitSound(3), BLOCK, BREAK, KNOCK_OUT]);
  });

  it('ignores a cast with a card it does not know', () => {
    const { played, event } = setup();
    event({ kind: 'ext:play', id: 'a', c: 9999, tg: '' });
    event({ kind: 'ext:play', id: 'a' });
    expect(played).toHaveLength(0);
  });

  it('plays the impact at once when the player prefers less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { played, event } = setup();
    event({ kind: 'ext:play', id: 'a', c: idx('Zap'), tg: 'b' });
    event({ kind: 'hit', id: 'b', n: 1 });
    expect(played).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
