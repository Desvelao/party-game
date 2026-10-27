import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameLoop } from './GameLoop';

describe('GameLoop', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps ticking after a step throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const loop = new GameLoop(100, () => {
      calls++;
      if (calls === 1) throw new Error('boom');
    });
    loop.start();
    await new Promise((r) => setTimeout(r, 120));
    loop.stop();
    expect(calls).toBeGreaterThan(2);
  });
});

describe('GameLoop catch-up and overrun', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes a fixed dt and counts ticks in stats; reset starts a new window', async () => {
    const dts: number[] = [];
    const loop = new GameLoop(200, (dt) => dts.push(dt));
    loop.start();
    await new Promise((r) => setTimeout(r, 60));
    loop.stop();
    expect(dts.length).toBeGreaterThan(2);
    for (const dt of dts) expect(dt).toBeCloseTo(1 / 200, 10);
    const s = loop.stats(true);
    expect(s.ticks).toBe(dts.length);
    expect(s.avgLagMs).toBeGreaterThanOrEqual(0);
    expect(loop.stats().ticks).toBe(0);
  });

  it('catches up after a stall (bounded) and records an overrun when too far behind', async () => {
    let calls = 0;
    const loop = new GameLoop(100, () => {
      calls++;
      if (calls === 1) {
        const end = performance.now() + 120; // block ~12 steps
        while (performance.now() < end);
      }
    });
    loop.start();
    await new Promise((r) => setTimeout(r, 50));
    loop.stop();
    const s = loop.stats();
    expect(s.overruns).toBeGreaterThanOrEqual(1);
    // first wakeup runs at most MAX_CATCHUP (5) steps, so a ~12 step backlog is dropped, not replayed
    expect(s.ticks).toBeLessThan(12);
    expect(s.ticks).toBeGreaterThanOrEqual(5);
    expect(s.maxStepMs).toBeGreaterThanOrEqual(100);
  });

  it('stop() prevents further ticks', async () => {
    let calls = 0;
    const loop = new GameLoop(200, () => calls++);
    loop.start();
    loop.stop();
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(0);
  });
});
