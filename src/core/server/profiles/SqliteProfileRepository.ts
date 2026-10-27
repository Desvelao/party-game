import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  applyPatch,
  applyResult,
  newRecord,
  reviveRecord,
  type ProfilePatch,
  type ProfileRecord,
  type ResultDelta,
} from './profile';
import { ProfileLimitError, type AdminRepository } from './ProfileRepository';

/** The few better-sqlite3 members this driver uses (keeps tests free of the native module). */
export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
  pragma(source: string): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}
export type SqliteOpen = (path: string) => SqliteDatabase;

export interface SqliteOptions {
  path: string;
  busyTimeoutMs: number;
  maxProfiles: number;
}

/** Raised for problems an operator can fix; reported as one line at startup. */
export class SqliteUnavailableError extends Error {}

/** `better-sqlite3` is an optional dependency (no prebuilt binary on every board): load it on demand. */
export async function loadBetterSqlite(): Promise<SqliteOpen> {
  try {
    const mod = (await import('better-sqlite3')) as unknown as { default: new (path: string) => SqliteDatabase };
    const Database = mod.default;
    return (path) => new Database(path);
  } catch (err) {
    throw new SqliteUnavailableError(
      `SQLite driver unavailable on this platform (${(err as Error).message.split('\n')[0]}); use storage.store: json`,
    );
  }
}

export interface ProfileRow {
  id: string;
  name: string;
  color: number;
  /** the looks by model (JSON); before schema 10 one flat look */
  look: string;
  avatar: string | null;
  lang: string | null;
  presets: string | null;
  controls: string | null;
  touch: string | null;
  emote_keys: string | null;
  daily: string | null;
  access: string | null;
  audio: string | null;
  recent: string | null;
  shadow_banned: number | null;
  created_at: number;
  last_seen: number;
  matches: number;
  wins: number;
  points: number;
  games_played: number;
  best_match_score: number;
  last_played: number;
  games: string;
}

/** Row → record, through the shared defensive reviver so a hand-edited database cannot inject junk. */
export function rowToRecord(row: ProfileRow): ProfileRecord {
  const json = (s: string | null) => {
    if (s === null || s === undefined) return undefined;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const rec = reviveRecord(
    {
      name: row.name,
      color: row.color,
      looks: json(row.look),
      avatar: row.avatar ?? undefined,
      lang: row.lang ?? undefined,
      presets: json(row.presets),
      controls: json(row.controls ?? null),
      touch: json(row.touch ?? null),
      emoteKeys: json(row.emote_keys ?? null),
      daily: json(row.daily ?? null),
      access: json(row.access ?? null),
      audio: json(row.audio ?? null),
      recent: json(row.recent ?? null),
      shadowBanned: row.shadow_banned === 1 ? true : undefined,
      createdAt: row.created_at,
      lastSeen: row.last_seen,
      stats: {
        matches: row.matches,
        wins: row.wins,
        points: row.points,
        gamesPlayed: row.games_played,
        bestMatchScore: row.best_match_score,
        lastPlayed: row.last_played,
        games: json(row.games) ?? {},
      },
    },
    row.created_at,
  );
  // reviveRecord only returns null for non-objects
  return rec as ProfileRecord;
}

/** Record → positional parameters for the INSERT OR REPLACE below. */
export function recordToParams(id: string, r: ProfileRecord): unknown[] {
  return [
    id,
    r.name,
    r.color,
    JSON.stringify(r.looks),
    r.avatar ?? null,
    r.lang ?? null,
    r.presets ? JSON.stringify(r.presets) : null,
    r.controls ? JSON.stringify(r.controls) : null,
    r.touch ? JSON.stringify(r.touch) : null,
    r.emoteKeys ? JSON.stringify(r.emoteKeys) : null,
    r.daily ? JSON.stringify(r.daily) : null,
    r.access ? JSON.stringify(r.access) : null,
    r.audio ? JSON.stringify(r.audio) : null,
    r.recent ? JSON.stringify(r.recent) : null,
    r.shadowBanned ? 1 : 0,
    r.createdAt,
    r.lastSeen,
    r.stats.matches,
    r.stats.wins,
    r.stats.points,
    r.stats.gamesPlayed,
    r.stats.bestMatchScore,
    r.stats.lastPlayed,
    JSON.stringify(r.stats.games),
  ];
}

const SCHEMA_VERSION = '10';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  color            INTEGER NOT NULL DEFAULT 0,
  look             TEXT NOT NULL,
  avatar           TEXT,
  lang             TEXT,
  presets          TEXT,
  controls         TEXT,
  touch            TEXT,
  emote_keys       TEXT,
  daily            TEXT,
  access           TEXT,
  audio            TEXT,
  recent           TEXT,
  shadow_banned    INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  last_seen        INTEGER NOT NULL,
  matches          INTEGER NOT NULL DEFAULT 0,
  wins             INTEGER NOT NULL DEFAULT 0,
  points           INTEGER NOT NULL DEFAULT 0,
  games_played     INTEGER NOT NULL DEFAULT 0,
  best_match_score INTEGER NOT NULL DEFAULT 0,
  last_played      INTEGER NOT NULL DEFAULT 0,
  games            TEXT NOT NULL DEFAULT '{}'
);`;

const UPSERT = `INSERT OR REPLACE INTO profiles
  (id, name, color, look, avatar, lang, presets, controls, touch, emote_keys, daily, access, audio, recent, shadow_banned, created_at, last_seen, matches, wins, points, games_played, best_match_score, last_played, games)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * SQLite-backed profiles (`storage.store: sqlite`). Same record logic as the other drivers
 * (profile.ts); better-sqlite3 is synchronous, wrapped here in the async repository interface.
 */
export class SqliteProfileRepository implements AdminRepository {
  private db: SqliteDatabase | null = null;

  constructor(
    private readonly opts: SqliteOptions,
    private readonly open: () => Promise<SqliteOpen> = loadBetterSqlite,
    private readonly clock: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    const openDb = await this.open();
    try {
      if (this.opts.path !== ':memory:') mkdirSync(dirname(this.opts.path), { recursive: true });
      const db = openDb(this.opts.path);
      db.pragma(`busy_timeout = ${Math.max(0, Math.floor(this.opts.busyTimeoutMs))}`);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.exec(SCHEMA);
      // databases created before schema 2 have no `controls` column, before schema 3 no `touch`, before schema 4 no `emote_keys`, before schema 5 no `daily`, before schema 6 no `access`, before schema 7 no `audio`, before schema 8 no `shadow_banned`, before schema 9 no `recent`, before schema 10 no `avatar` (and `look` held one flat look, read as the legacy model's)
      const cols = db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'controls')) db.exec('ALTER TABLE profiles ADD COLUMN controls TEXT');
      if (!cols.some((c) => c.name === 'touch')) db.exec('ALTER TABLE profiles ADD COLUMN touch TEXT');
      if (!cols.some((c) => c.name === 'emote_keys')) db.exec('ALTER TABLE profiles ADD COLUMN emote_keys TEXT');
      if (!cols.some((c) => c.name === 'daily')) db.exec('ALTER TABLE profiles ADD COLUMN daily TEXT');
      if (!cols.some((c) => c.name === 'access')) db.exec('ALTER TABLE profiles ADD COLUMN access TEXT');
      if (!cols.some((c) => c.name === 'audio')) db.exec('ALTER TABLE profiles ADD COLUMN audio TEXT');
      if (!cols.some((c) => c.name === 'shadow_banned')) db.exec('ALTER TABLE profiles ADD COLUMN shadow_banned INTEGER NOT NULL DEFAULT 0');
      if (!cols.some((c) => c.name === 'recent')) db.exec('ALTER TABLE profiles ADD COLUMN recent TEXT');
      if (!cols.some((c) => c.name === 'avatar')) db.exec('ALTER TABLE profiles ADD COLUMN avatar TEXT');
      db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(SCHEMA_VERSION, 'schema_version');
      this.db = db;
    } catch (err) {
      throw new SqliteUnavailableError(`cannot open SQLite database ${this.opts.path}: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  private get conn(): SqliteDatabase {
    if (!this.db) throw new Error('SqliteProfileRepository used before init()');
    return this.db;
  }

  private read(id: string): ProfileRecord | null {
    const row = this.conn.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  private count(): number {
    return (this.conn.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  }

  private write(id: string, rec: ProfileRecord): void {
    this.conn.prepare(UPSERT).run(...recordToParams(id, rec));
  }

  async get(id: string): Promise<ProfileRecord | null> {
    return this.read(id);
  }

  async upsert(id: string, patch: ProfilePatch): Promise<ProfileRecord> {
    const now = this.clock();
    return this.conn.transaction(() => {
      const cur = this.read(id);
      if (!cur && this.count() >= this.opts.maxProfiles) throw new ProfileLimitError();
      const next = cur ? applyPatch(cur, patch, now) : newRecord(now, patch);
      this.write(id, next);
      return next;
    })();
  }

  async recordResult(id: string, delta: ResultDelta): Promise<void> {
    const now = this.clock();
    this.conn.transaction(() => {
      let cur = this.read(id);
      if (!cur) {
        if (this.count() >= this.opts.maxProfiles) throw new ProfileLimitError();
        cur = newRecord(now, { name: delta.name });
      }
      this.write(id, applyResult(cur, delta, now));
    })();
  }

  async entries(): Promise<[string, ProfileRecord][]> {
    const rows = this.conn.prepare('SELECT * FROM profiles').all() as ProfileRow[];
    return rows.map((r) => [r.id, rowToRecord(r)]);
  }

  async importRecord(id: string, record: ProfileRecord): Promise<void> {
    this.conn.transaction(() => {
      if (!this.read(id) && this.count() >= this.opts.maxProfiles) throw new ProfileLimitError();
      this.write(id, record);
    })();
  }

  async delete(id: string): Promise<boolean> {
    const res = this.conn.prepare('DELETE FROM profiles WHERE id = ?').run(id) as { changes?: number } | undefined;
    return (res?.changes ?? 0) > 0;
  }

  async close(): Promise<void> {
    if (!this.db) return;
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* closing anyway */
    }
    this.db.close();
    this.db = null;
  }
}
