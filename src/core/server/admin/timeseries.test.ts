import { describe, expect, it } from 'vitest';
import { MetricsSampler } from './timeseries';

describe('MetricsSampler', () => {
  it('keeps a bounded window and turns cumulative overruns into per-interval counts', () => {
    let overruns = 0;
    const s = new MetricsSampler({ rooms: () => 2, clients: () => 5, loop: () => ({ overruns, avgStepMs: 1.234 }) }, 5000, 3);
    overruns = 4;
    expect(s.sample(1000).overruns).toBe(4);
    overruns = 6;
    expect(s.sample(2000).overruns).toBe(2);
    overruns = 1; // stats window was reset
    expect(s.sample(3000).overruns).toBe(1);
    s.sample(4000);
    const pts = s.list();
    expect(pts).toHaveLength(3);
    expect(pts[0]!.ts).toBe(2000);
    expect(pts[2]).toMatchObject({ rooms: 2, clients: 5, avgStepMs: 1.23 });
    expect(pts[2]!.memPct).toBeGreaterThan(0);
  });

  it('exposes its sampling interval', () => {
    const src = { rooms: () => 0, clients: () => 0, loop: () => ({ overruns: 0, avgStepMs: 0 }) };
    expect(new MetricsSampler(src).intervalMs).toBe(5000);
    expect(new MetricsSampler(src, 1000).intervalMs).toBe(1000);
  });
});
