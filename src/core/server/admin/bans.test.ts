import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BanList } from './bans';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('BanList', () => {
  it('bans, lifts and expires', () => {
    let t = 1000;
    const b = new BanList(null, () => t);
    b.add('ip', '1.2.3.4', { reason: 'spam' });
    b.add('profile', 'abc', { minutes: 1 });
    expect(b.isBanned('ip', '1.2.3.4')).toBe(true);
    expect(b.isBanned('ip', '1.2.3.5')).toBe(false);
    expect(b.isBanned('profile', null)).toBe(false);
    expect(b.isBanned('profile', 'abc')).toBe(true);
    t += 61_000;
    expect(b.isBanned('profile', 'abc')).toBe(false);
    expect(b.list().map((e) => e.value)).toEqual(['1.2.3.4']);
    expect(b.remove('ip', '1.2.3.4')).toBe(true);
    expect(b.remove('ip', '1.2.3.4')).toBe(false);
  });

  it('describes a ban for the banned player: reason and minutes left, rounded up', () => {
    let t = 0;
    const b = new BanList(null, () => t);
    b.add('ip', '1.2.3.4', { reason: 'spam', minutes: 10 });
    b.add('profile', 'abc');
    t += 90_000;
    expect(b.describe('ip', '1.2.3.4')).toEqual({ reason: 'spam', minutes: 9 });
    expect(b.describe('profile', 'abc')).toEqual({});
    expect(b.describe('ip', '9.9.9.9')).toEqual({});
  });

  it('survives a restart through its file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pg-bans-'));
    const file = join(dir, 'bans.json');
    const a = new BanList(file);
    a.add('ip', '9.9.9.9', { reason: 'x' });
    await a.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    expect(new BanList(file).isBanned('ip', '9.9.9.9')).toBe(true);
  });

  it('ignores a corrupt file', () => {
    dir = mkdtempSync(join(tmpdir(), 'pg-bans-'));
    const file = join(dir, 'bans.json');
    writeFileSync(file, '{not json');
    expect(new BanList(file).list()).toEqual([]);
  });
});
