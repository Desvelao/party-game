import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { RuntimeConfig } from './runtimeConfig';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('RuntimeConfig', () => {
  it('applies valid changes in place and notifies', () => {
    const cfg = loadConfig();
    const onChange = vi.fn();
    const rc = new RuntimeConfig(cfg, null, onChange);
    const before = cfg.maxRooms;
    expect(rc.patch({ maxRooms: 7, joinTimeoutMs: 5000 })).toEqual({ ok: true });
    expect(cfg.maxRooms).toBe(7);
    expect(cfg.joinTimeoutMs).toBe(5000);
    expect(rc.snapshot().overridden.sort()).toEqual(['joinTimeoutMs', 'maxRooms']);
    expect(rc.snapshot().defaults.maxRooms).toBe(before);
    expect(onChange).toHaveBeenCalled();
  });

  it('changes the branding text, cleans it, and rejects bad values', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pg-rc-'));
    const file = join(dir, 'runtime.json');
    const cfg = loadConfig();
    const rc = new RuntimeConfig(cfg, file);
    expect(cfg.brandName).toBe('Party Game');
    expect(cfg.welcomeMessage).toBe('');
    expect(rc.patch({ brandName: '  Bonk\nNight ', welcomeMessage: 'Hi there!' })).toEqual({ ok: true });
    expect(cfg.brandName).toBe('Bonk Night');
    expect(cfg.welcomeMessage).toBe('Hi there!');
    expect(rc.patch({ brandName: 5 })).toMatchObject({ ok: false });
    expect(rc.patch({ brandName: '   ' })).toMatchObject({ ok: false });
    expect(rc.patch({ welcomeMessage: 'x'.repeat(141) })).toMatchObject({ ok: false });
    expect(rc.patch({ welcomeMessage: '' })).toEqual({ ok: true });
    expect(cfg.welcomeMessage).toBe('');
    expect(rc.snapshot().ranges.brandName).toEqual({ min: 0, max: 40 });
    await rc.flush();
    const again = loadConfig();
    new RuntimeConfig(again, file);
    expect(again.brandName).toBe('Bonk Night');
    expect(rc.patch({ brandName: null })).toEqual({ ok: true });
    expect(cfg.brandName).toBe('Party Game');
    await rc.flush();
  });

  it('rejects out-of-range, non-integer, unknown and restart-only settings without changing anything', () => {
    const cfg = loadConfig();
    const rc = new RuntimeConfig(cfg);
    const before = { ...cfg };
    const res = rc.patch({ maxRooms: 9999, maxPlayersPerRoom: 1.5, port: 1, nonsense: 1, idleRoomSeconds: 60 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(Object.keys(res.errors).sort()).toEqual(['maxPlayersPerRoom', 'maxRooms', 'nonsense', 'port']);
      expect(res.errors.port).toMatch(/restart/);
    }
    expect(cfg).toEqual(before);
  });

  it('null returns one field to its configured value; reset returns all', () => {
    const cfg = loadConfig();
    const rc = new RuntimeConfig(cfg);
    const rooms = cfg.maxRooms;
    const idle = cfg.idleRoomSeconds;
    rc.patch({ maxRooms: 9, idleRoomSeconds: idle + 1 });
    rc.patch({ maxRooms: null });
    expect(cfg.maxRooms).toBe(rooms);
    expect(cfg.idleRoomSeconds).toBe(idle + 1);
    rc.reset();
    expect(cfg.idleRoomSeconds).toBe(idle);
    expect(rc.snapshot().overridden).toEqual([]);
  });

  it('the idle warning lead time is tunable at runtime, 0 turns it off', () => {
    const cfg = loadConfig();
    expect(cfg.idleWarnSeconds).toBe(60);
    const rc = new RuntimeConfig(cfg);
    expect(rc.patch({ idleWarnSeconds: 0 })).toEqual({ ok: true });
    expect(cfg.idleWarnSeconds).toBe(0);
    expect(rc.patch({ idleWarnSeconds: 99_999 }).ok).toBe(false);
    rc.patch({ idleWarnSeconds: null });
    expect(cfg.idleWarnSeconds).toBe(60);
  });

  it('persists overrides and re-applies them after a restart', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pg-rc-'));
    const file = join(dir, 'runtime-config.json');
    const a = new RuntimeConfig(loadConfig(), file);
    a.patch({ maxRooms: 11 });
    await a.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ maxRooms: 11 });
    const cfg2 = loadConfig();
    new RuntimeConfig(cfg2, file);
    expect(cfg2.maxRooms).toBe(11);
  });
});
