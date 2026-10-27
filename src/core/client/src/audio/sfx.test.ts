import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeCtx {
  static instances: FakeCtx[] = [];
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  oscillators = 0;
  resumes = 0;
  constructor() {
    FakeCtx.instances.push(this);
  }
  resume() {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createOscillator() {
    this.oscillators++;
    return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
  }
}

async function freshSfx() {
  vi.resetModules();
  return (await import('./sfx')).sfx;
}

describe('sfx audio context', () => {
  beforeEach(() => {
    FakeCtx.instances = [];
    (globalThis as any).AudioContext = FakeCtx;
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };
  });
  afterEach(() => {
    delete (globalThis as any).AudioContext;
    delete (globalThis as any).localStorage;
  });

  it('unlock creates one context, resumes it and is idempotent', async () => {
    const sfx = await freshSfx();
    sfx.unlock();
    sfx.unlock();
    expect(FakeCtx.instances).toHaveLength(1);
    expect(FakeCtx.instances[0].state).toBe('running');
  });

  it('resume never creates a context, but a later gesture unlock makes sounds audible', async () => {
    const sfx = await freshSfx();
    sfx.resume();
    expect(FakeCtx.instances).toHaveLength(0);
    sfx.unlock();
    sfx.play('click');
    expect(FakeCtx.instances[0].oscillators).toBe(1);
  });

  it('a sound requested before any gesture reports blocked once and plays nothing', async () => {
    const sfx = await freshSfx();
    const cb = vi.fn();
    sfx.onBlocked = cb;
    sfx.play('click');
    sfx.play('click');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(sfx.isBlocked()).toBe(true);
  });

  it('a suspended context is nudged to resume when a sound is requested', async () => {
    const sfx = await freshSfx();
    sfx.unlock();
    const ctx = FakeCtx.instances[0];
    ctx.state = 'suspended';
    const before = ctx.resumes;
    sfx.play('click');
    expect(ctx.resumes).toBeGreaterThan(before);
  });

  it('muted: nothing is scheduled and nothing is reported as blocked', async () => {
    const sfx = await freshSfx();
    sfx.setMuted(true);
    const cb = vi.fn();
    sfx.onBlocked = cb;
    sfx.play('click');
    expect(cb).not.toHaveBeenCalled();
    expect(sfx.isBlocked()).toBe(false);
  });
});
