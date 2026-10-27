import { describe, expect, it } from 'vitest';
import { EntityTracker } from './track';
import { registerGame, pluginForKind } from './registry';

describe('EntityTracker', () => {
  it('derives velocity from two observations', () => {
    const t = new EntityTracker();
    expect(t.observe(1, 0, 0, 0).known).toBe(false);
    const tr = t.observe(1, 10, 5, 0.05);
    expect(tr.vx).toBeCloseTo(200);
    expect(tr.vy).toBeCloseTo(100);
  });

  it('prefers the simulated velocity when the simulation matches the observation', () => {
    const t = new EntityTracker();
    t.observe(1, 0, 0, 0);
    t.observe(1, 10, 0, 0.05); // known
    // pretend the entity bounced: simulation says it ends at x=10 with reversed velocity
    const tr = t.observe(1, 20, 0, 0.1, () => ({ x: 20, y: 0, vx: -300, vy: 0 }));
    expect(tr.vx).toBe(-300);
    expect(t.corrected).toBe(1);
  });
});

describe('registry', () => {
  it('lets a game plug in without touching the core', () => {
    registerGame({ id: 'dummy', kind: 'ext:dummy', policies: ['x'], defaultPolicy: 'x', defaultParams: {}, create: () => null as never });
    expect(pluginForKind('ext:dummy')?.id).toBe('dummy');
  });
});
