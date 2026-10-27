import { describe, expect, it } from 'vitest';
import { EdgeButton, Lapses, ReactionBuffer, jitter } from './humanize';

const view = (recvMs: number) => ({ recvMs });

describe('ReactionBuffer', () => {
  it('hands out the newest view that is at least delayMs old', () => {
    const b = new ReactionBuffer<{ recvMs: number }>();
    [0, 50, 100, 150].forEach((t) => b.push(view(t)));
    expect(b.at(150, 0)?.recvMs).toBe(150);
    expect(b.at(150, 60)?.recvMs).toBe(50);
    expect(b.at(150, 100)?.recvMs).toBe(50);
    expect(b.at(150, 150)?.recvMs).toBe(0);
  });

  it('falls back to the oldest view when none is old enough, and to null when empty', () => {
    const b = new ReactionBuffer<{ recvMs: number }>();
    expect(b.at(100, 50)).toBeNull();
    expect(b.latest).toBeNull();
    b.push(view(90));
    expect(b.at(100, 500)?.recvMs).toBe(90);
  });

  it('keeps only the latest `size` views, and clear empties it', () => {
    const b = new ReactionBuffer<{ recvMs: number }>(3);
    for (let t = 0; t < 10; t++) b.push(view(t));
    expect(b.latest?.recvMs).toBe(9);
    expect(b.at(9, 1000)?.recvMs).toBe(7); // the oldest one still held
    b.clear();
    expect(b.latest).toBeNull();
  });
});

describe('Lapses', () => {
  it('never lapses at rate 0', () => {
    const l = new Lapses(() => 0);
    for (let t = 0; t < 5000; t += 33) expect(l.active(t, 0)).toBe(false);
    expect(l.count).toBe(0);
  });

  it('freezes for 300-600 ms once it starts, then recovers', () => {
    const l = new Lapses(() => 0); // the roll always succeeds, the freeze is the shortest
    expect(l.active(0, 10)).toBe(false); // first call: no time has passed yet
    expect(l.active(100, 10)).toBe(true);
    expect(l.count).toBe(1);
    expect(l.active(399, 0)).toBe(true);
    expect(l.active(401, 0)).toBe(false);
  });

  it('does not start a second lapse while one is running', () => {
    const l = new Lapses(() => 0);
    l.active(0, 10);
    l.active(100, 10);
    l.active(200, 10);
    expect(l.count).toBe(1);
  });
});

describe('EdgeButton', () => {
  it('holds a press, then needs a gap before the next one', () => {
    const b = new EdgeButton(70, 70);
    expect(b.press(0)).toBe(true);
    expect([b.down(0), b.down(69), b.down(70)]).toEqual([true, true, false]);
    expect(b.press(100)).toBe(false); // released at 70, the gap runs to 140
    expect(b.ready(139)).toBe(false);
    expect(b.ready(140)).toBe(true);
    expect(b.press(140)).toBe(true);
    expect(b.presses).toBe(2);
  });
});

describe('jitter', () => {
  it('stays in [-1, 1] and is centred', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const j = jitter(rng);
      expect(Math.abs(j)).toBeLessThanOrEqual(1);
      sum += j;
    }
    expect(Math.abs(sum / 2000)).toBeLessThan(0.1);
  });
});
