import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonProfileRepository } from './JsonProfileRepository';
import { MemoryProfileRepository } from './MemoryProfileRepository';
import { SqliteProfileRepository, SqliteUnavailableError, loadBetterSqlite, recordToParams, rowToRecord } from './SqliteProfileRepository';
import { defaultControls } from '../../shared';
import { newRecord, applyResult } from './profile';
import { ProfileLimitError, type ProfileRepository } from './ProfileRepository';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'pg-profiles-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Behaviour every ProfileRepository implementation (file, memory, a future DB) must satisfy. */
function contract(name: string, make: (max: number) => ProfileRepository) {
  const fresh = async (max: number) => {
    const repo = make(max);
    await repo.init?.();
    return repo;
  };
  describe(`${name} (repository contract)`, () => {
    it('deletes a record and reports whether it existed', async () => {
      const repo = (await fresh(10)) as ProfileRepository & { delete(id: string): Promise<boolean> };
      await repo.upsert('d1', { name: 'Del' });
      expect(await repo.delete('d1')).toBe(true);
      expect(await repo.get('d1')).toBeNull();
      expect(await repo.delete('d1')).toBe(false);
      // the freed slot can be used again
      for (let i = 0; i < 10; i++) await repo.upsert(`k${i}`, { name: 'x' });
    });

    it('returns null for unknown ids', async () => {
      expect(await (await fresh(10)).get('nope')).toBeNull();
    });

    it('creates on upsert, then merges patches', async () => {
      const repo = await fresh(10);
      const a = await repo.upsert('u1', { name: 'Ann', color: 4 });
      expect(a).toMatchObject({ name: 'Ann', color: 4 });
      const b = await repo.upsert('u1', { looks: { blob: { hat: 1 } }, avatar: 'blob' });
      expect(b.name).toBe('Ann');
      expect(b.looks.blob.hat).toBe(1);
      expect((await repo.get('u1'))!.looks.blob.hat).toBe(1);
      expect((await repo.get('u1'))!.avatar).toBe('blob');
    });

    it('stores the language', async () => {
      const repo = await fresh(10);
      await repo.upsert('l', { lang: 'es' });
      expect((await repo.get('l'))!.lang).toBe('es');
      await repo.upsert('l', { name: 'Z' });
      expect((await repo.get('l'))!.lang).toBe('es');
    });

    it('records results, creating the profile when needed', async () => {
      const repo = await fresh(10);
      await repo.recordResult('u2', { name: 'Bo', game: { id: 'arena', place: 1, points: 10 } });
      await repo.recordResult('u2', { name: 'Bo', match: { score: 10, won: true } });
      const r = (await repo.get('u2'))!;
      expect(r.name).toBe('Bo');
      expect(r.stats).toMatchObject({ gamesPlayed: 1, points: 10, matches: 1, wins: 1 });
    });

    it('handles concurrent results without losing any', async () => {
      const repo = await fresh(10);
      await Promise.all(
        Array.from({ length: 20 }, () => repo.recordResult('u3', { name: 'C', game: { id: 'g', place: 2, points: 1 } })),
      );
      expect((await repo.get('u3'))!.stats.gamesPlayed).toBe(20);
    });

    it('refuses new profiles beyond the cap but keeps updating existing ones', async () => {
      const repo = await fresh(1);
      await repo.upsert('a', {});
      await expect(repo.upsert('b', {})).rejects.toBeInstanceOf(ProfileLimitError);
      await expect(repo.recordResult('b', { name: 'x' })).rejects.toBeInstanceOf(ProfileLimitError);
      await expect(repo.upsert('a', { name: 'New' })).resolves.toMatchObject({ name: 'New' });
    });
  });
}

contract('MemoryProfileRepository', (max) => new MemoryProfileRepository(max));
contract('JsonProfileRepository', (max) => new JsonProfileRepository(join(tmp(), 'profiles.json'), max, 10));

// the native module is optional: skip the sqlite suites where it cannot be loaded
const sqliteAvailable = await loadBetterSqlite().then(
  () => true,
  () => false,
);
const sqliteRepo = (file: string, max = 10_000) => new SqliteProfileRepository({ path: file, busyTimeoutMs: 1000, maxProfiles: max });
if (sqliteAvailable) contract('SqliteProfileRepository', (max) => sqliteRepo(join(tmp(), 'sub', 'profiles.db'), max));

describe.skipIf(!sqliteAvailable)('SqliteProfileRepository specifics', () => {
  it('survives a restart and creates the parent directory', async () => {
    const file = join(tmp(), 'nested', 'dir', 'profiles.db');
    const a = sqliteRepo(file);
    await a.init();
    await a.upsert('u', { name: 'Ann', color: 2, lang: 'es' });
    await a.recordResult('u', { name: 'Ann', game: { id: 'arena', place: 1, points: 10 } });
    await a.recordResult('u', { name: 'Ann', match: { score: 10, won: true } });
    await a.close();
    const b = sqliteRepo(file);
    await b.init();
    expect(await b.get('u')).toMatchObject({
      name: 'Ann',
      color: 2,
      lang: 'es',
      stats: { matches: 1, wins: 1, points: 10, gamesPlayed: 1, games: { arena: { played: 1, wins: 1, points: 10 } } },
    });
    await b.close();
  });

  it('exports and imports records (used by the migrate tool)', async () => {
    const a = sqliteRepo(join(tmp(), 'a.db'));
    await a.init();
    await a.upsert('x', { name: 'X' });
    await a.upsert('y', { name: 'Y' });
    const b = sqliteRepo(join(tmp(), 'b.db'));
    await b.init();
    for (const [id, rec] of await a.entries()) await b.importRecord(id, rec);
    for (const [id, rec] of await a.entries()) await b.importRecord(id, rec); // idempotent
    expect((await b.entries()).map(([id]) => id).sort()).toEqual(['x', 'y']);
    expect(await b.get('x')).toEqual(await a.get('x'));
    await a.close();
    await b.close();
  });

  it('persists controls and migrates a database created before the column existed', async () => {
    const file = join(tmp(), 'old.db');
    // a version-1 database: no `controls` column
    const mod = (await import('better-sqlite3')) as unknown as { default: new (p: string) => { exec(sql: string): void; close(): void } };
    const old = new mod.default(file);
    old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0, look TEXT NOT NULL,
        lang TEXT, presets TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, matches INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, games_played INTEGER NOT NULL DEFAULT 0,
        best_match_score INTEGER NOT NULL DEFAULT 0, last_played INTEGER NOT NULL DEFAULT 0, games TEXT NOT NULL DEFAULT '{}');
      INSERT INTO meta VALUES ('schema_version', '1');
      INSERT INTO profiles (id, name, look, created_at, last_seen) VALUES ('old', 'Olga', '{}', 1, 1);`);
    old.close();
    const repo = sqliteRepo(file);
    await repo.init();
    expect((await repo.get('old'))!.name).toBe('Olga');
    expect((await repo.get('old'))!.controls).toBeUndefined();
    const saved = await repo.upsert('old', { controls: { ...defaultControls(), action: ['KeyF'] } });
    expect(saved.controls!.action).toEqual(['KeyF']);
    await repo.close();
    const again = sqliteRepo(file);
    await again.init();
    expect((await again.get('old'))!.controls!.action).toEqual(['KeyF']);
    await again.close();
  });

  it('reports an unusable database file with one clear message', async () => {
    const file = join(tmp(), 'garbage.db');
    writeFileSync(file, 'this is definitely not a sqlite database, just text '.repeat(40));
    const repo = sqliteRepo(file);
    await expect(repo.init()).rejects.toThrow(/cannot open SQLite database .*garbage\.db/);
  });

  it('refuses use before init', async () => {
    await expect(sqliteRepo(join(tmp(), 'x.db')).get('a')).rejects.toThrow(/before init/);
  });
});

describe('SqliteProfileRepository without the native module', () => {
  it('fails with a message that points to the json driver', async () => {
    const repo = new SqliteProfileRepository({ path: 'x', busyTimeoutMs: 0, maxProfiles: 1 }, async () => {
      throw new SqliteUnavailableError('SQLite driver unavailable on this platform (boom); use storage.store: json');
    });
    await expect(repo.init()).rejects.toThrow(/use storage\.store: json/);
  });
});

describe('sqlite row mapping', () => {
  it('round-trips a record through the row shape', () => {
    let rec = newRecord(1000, { name: 'Row', color: 3, lang: 'es' });
    rec = applyResult(rec, { name: 'Row', game: { id: 'g', place: 1, points: 7 } }, Date.now());
    rec = {
      ...rec,
      touch: { show: 'on', move: 'cross', size: 'large', opacity: 60, hand: 'left', haptics: false, floating: true, perGame: { 'tank-wars': 'joystick' } },
      access: { colorblind: true, markers: true, motion: 'low' },
      audio: { master: 80, sfx: 50, music: 0 },
      shadowBanned: true,
      recent: [{ ts: 9, players: 2, place: 1, score: 7, won: true, mvp: true, rounds: [{ game: 'arena', place: 1, points: 3 }] }],
      emoteKeys: { toggle: 'KeyG', emotes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN'] },
    };
    const p = recordToParams('id1', rec);
    const row = {
      id: p[0], name: p[1], color: p[2], look: p[3], avatar: p[4], lang: p[5], presets: p[6], controls: p[7], touch: p[8], emote_keys: p[9], daily: p[10], access: p[11], audio: p[12], recent: p[13], shadow_banned: p[14], created_at: p[15], last_seen: p[16],
      matches: p[17], wins: p[18], points: p[19], games_played: p[20], best_match_score: p[21], last_played: p[22], games: p[23],
    } as Parameters<typeof rowToRecord>[0];
    expect(rowToRecord(row)).toEqual(rec);
  });
  it('reads a flat look saved before schema 10 as the legacy model', () => {
    const rec = rowToRecord({
      id: 'i', name: 'N', color: 0, look: '{"body":2,"hat":1}', avatar: null, lang: null, presets: null,
      controls: null, touch: null, emote_keys: null, daily: null, access: null, audio: null, recent: null, shadow_banned: 0, created_at: 5, last_seen: 5,
      matches: 0, wins: 0, points: 0, games_played: 0, best_match_score: 0, last_played: 0, games: '{}',
    });
    expect(rec.looks).toEqual({ blob: { body: 2, hat: 1 } });
  });
  it('tolerates null columns and broken JSON', () => {
    const rec = rowToRecord({
      id: 'i', name: 'N', color: 0, look: '{not json', avatar: null, lang: null, presets: null,
      controls: null, touch: null, emote_keys: null, daily: null, access: null, audio: null, recent: null, shadow_banned: 0, created_at: 5, last_seen: 5,
      matches: 0, wins: 0, points: 0, games_played: 0, best_match_score: 0, last_played: 0, games: '[]x',
    });
    expect(rec.lang).toBeUndefined();
    expect(rec.presets).toBeUndefined();
    expect(rec.looks).toEqual({});
    expect(rec.stats.games).toEqual({});
  });
});

describe('JsonProfileRepository persistence', () => {
  it('survives a restart', async () => {
    const file = join(tmp(), 'sub', 'profiles.json');
    const a = new JsonProfileRepository(file, 10, 10);
    await a.upsert('u', { name: 'Ann', color: 2 });
    await a.recordResult('u', { name: 'Ann', match: { score: 9, won: true } });
    await a.close();
    const b = new JsonProfileRepository(file, 10, 10);
    expect(await b.get('u')).toMatchObject({ name: 'Ann', color: 2, stats: { matches: 1, wins: 1 } });
    await b.close();
  });

  it('moves a corrupt file aside and starts empty', async () => {
    const dir = tmp();
    const file = join(dir, 'profiles.json');
    writeFileSync(file, '{ not json');
    const repo = new JsonProfileRepository(file, 10, 10);
    expect(await repo.get('x')).toBeNull();
    await repo.upsert('x', { name: 'N' });
    await repo.close();
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).profiles.x.name).toBe('N');
  });

  it('writes without blocking and keeps every change made while a write is in flight', async () => {
    const file = join(tmp(), 'profiles.json');
    const repo = new JsonProfileRepository(file, 100, 1);
    for (let i = 0; i < 20; i++) {
      await repo.upsert(`u${i}`, { name: `N${i}` });
      await new Promise((r) => setTimeout(r, 2)); // lets the debounce fire, so writes overlap the next changes
    }
    await repo.close();
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).profiles)).toHaveLength(20);
  });

  it('warns when a flush is slow, and keeps the data when the write fails', async () => {
    const dir = tmp();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let t = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (t += 1000));
    try {
      const slow = new JsonProfileRepository(join(dir, 'profiles.json'), 10, 10);
      await slow.upsert('u', { name: 'N' });
      await slow.close();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/flush took \d+ ms for 1 profiles/));

      writeFileSync(join(dir, 'blocker'), 'x'); // a file where the directory should be
      const bad = new JsonProfileRepository(join(dir, 'blocker', 'profiles.json'), 10, 10);
      await bad.upsert('u', { name: 'N' });
      await bad.close();
      expect(error).toHaveBeenCalledWith('[party-game] could not write profile store', expect.anything());
      expect(await bad.get('u')).toMatchObject({ name: 'N' });
    } finally {
      now.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('never leaves a temp file behind after flushing', async () => {
    const dir = tmp();
    const repo = new JsonProfileRepository(join(dir, 'profiles.json'), 10, 10);
    await repo.upsert('u', {});
    await repo.close();
    expect(readdirSync(dir)).toEqual(['profiles.json']);
  });
});
