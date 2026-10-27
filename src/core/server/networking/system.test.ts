import { describe, expect, it } from 'vitest';
import { sampleSystem } from './system';

describe('sampleSystem', () => {
  it('returns sane host metrics', () => {
    const s = sampleSystem();
    expect(s.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(s.cpuPercent).toBeLessThanOrEqual(100);
    expect(s.memUsedMB).toBeLessThanOrEqual(s.memTotalMB);
    expect(s.loadavg).toHaveLength(3);
    expect(s.processUptimeSec).toBeGreaterThanOrEqual(0);
  });
});
