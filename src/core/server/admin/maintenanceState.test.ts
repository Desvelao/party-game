import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PENDING, MAX_RECENT, MaintenanceState } from './maintenanceState';

describe('MaintenanceState', () => {
  const make = () => {
    let now = 1_000_000;
    const s = new MaintenanceState(null, () => now);
    return { s, advance: (ms: number) => void (now += ms) };
  };

  it('drains and clears', () => {
    const { s } = make();
    expect(s.isDraining).toBe(false);
    s.setDraining(true, { message: 'Back at 8', exitWhenEmpty: true });
    expect(s.isDraining).toBe(true);
    expect(s.exitsWhenEmpty).toBe(true);
    expect(s.info()).toEqual({ draining: true, message: 'Back at 8', banners: [], recent: [] });
    s.setDraining(false);
    expect(s.exitsWhenEmpty).toBe(false);
    expect(s.info().message).toBeUndefined();
  });

  it('sends an announcement once when its time comes', () => {
    const { s, advance } = make();
    s.announce('Soon', { at: 1_000_000 + 5000 });
    expect(s.tick().due).toEqual([]);
    advance(5000);
    const r = s.tick();
    expect(r.due.map((a) => a.message)).toEqual(['Soon']);
    expect(r.changed).toBe(true);
    expect(s.tick()).toEqual({ due: [], changed: false });
    expect(s.info().recent.map((x) => x.message)).toEqual(['Soon']);
    expect(s.info().banners).toEqual([]); // not pinned: a toast only
  });

  it('keeps a pinned announcement as a banner until it expires or is removed', () => {
    const { s, advance } = make();
    const a = s.announce('Pinned', { pinned: true, durationMs: 60_000 })!;
    const b = s.announce('Forever', { pinned: true })!;
    s.tick();
    expect(s.info().banners.map((x) => x.message)).toEqual(['Pinned', 'Forever']);
    advance(61_000);
    expect(s.tick().changed).toBe(true);
    expect(s.info().banners.map((x) => x.id)).toEqual([b.id]);
    expect(s.remove(b.id)).toBe(true);
    expect(s.remove(a.id)).toBe(false);
    expect(s.info().banners).toEqual([]);
    expect(s.info().recent).toHaveLength(2); // the history stays
  });

  it('caps the history and the waiting list', () => {
    const { s } = make();
    for (let i = 0; i < MAX_RECENT + 3; i++) s.announce(`m${i}`);
    s.tick();
    expect(s.info().recent).toHaveLength(MAX_RECENT);
    expect(s.info().recent[0]!.message).toBe(`m${MAX_RECENT + 2}`);
    for (let i = 0; i < MAX_PENDING; i++) expect(s.announce('later', { at: 9_999_999 })).not.toBeNull();
    expect(s.announce('too many', { at: 9_999_999 })).toBeNull();
  });

  it('tells listeners about operator changes only', () => {
    const { s } = make();
    let n = 0;
    s.onChange(() => n++);
    s.setDraining(true);
    s.announce('x');
    expect(n).toBe(2);
    s.tick();
    expect(n).toBe(2);
  });

  it('lets an operator remove delivered announcements from the history', () => {
    const { s } = make();
    const calls: number[] = [];
    s.onChange(() => calls.push(1));
    const a = s.announce('One', { pinned: true })!;
    const b = s.announce('Two')!;
    s.tick();
    calls.length = 0;
    expect(s.removeRecent(b.id)).toBe(true);
    expect(s.removeRecent(b.id)).toBe(false);
    expect(s.info().recent.map((x) => x.id)).toEqual([a.id]);
    expect(s.info().banners).toHaveLength(1); // the pinned banner is not the history
    expect(calls).toHaveLength(1);
    s.clearRecent();
    expect(s.info().recent).toEqual([]);
    expect(s.info().banners).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('survives a restart', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'maint-')), 'maintenance.json');
    const a = new MaintenanceState(file);
    a.setDraining(true, { message: 'Closing', exitWhenEmpty: true });
    a.announce('Pinned', { pinned: true });
    a.tick();
    await a.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).draining).toBe(true);
    const b = new MaintenanceState(file);
    expect(b.info()).toEqual(a.info());
    expect(b.exitsWhenEmpty).toBe(true);
  });
});
