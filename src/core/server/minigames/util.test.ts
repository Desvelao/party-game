import { describe, expect, it } from 'vitest';
import { LastStandingTracker, clamp, pick, r1, r2, smoothstep } from './util';

describe('minigame util helpers', () => {
  it('rounds', () => {
    expect(r1(1.26)).toBe(1.3);
    expect(r2(1.256)).toBe(1.26);
  });
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
  it('smoothsteps with clamped input', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
  });
  it('picks an element', () => {
    expect([1, 2, 3]).toContain(pick([1, 2, 3]));
  });
});

describe('LastStandingTracker', () => {
  it('ends multiplayer rounds at <=1 alive, solo at 0', () => {
    const multi = new LastStandingTracker(3);
    expect(multi.isOver(2)).toBe(false);
    expect(multi.isOver(1)).toBe(true);
    const solo = new LastStandingTracker(1);
    expect(solo.isOver(1)).toBe(false);
    expect(solo.isOver(0)).toBe(true);
  });
  it('ranks later eliminations better and ties simultaneous ones', () => {
    const t = new LastStandingTracker(4);
    const out = t.rankEliminated(
      [
        { id: 'a', elimOrder: 1 },
        { id: 'b', elimOrder: 3 },
        { id: 'c', elimOrder: 1 },
      ],
      2,
    );
    expect(out).toEqual([
      { id: 'b', place: 2 },
      { id: 'a', place: 3 },
      { id: 'c', place: 3 },
    ]);
  });
});
