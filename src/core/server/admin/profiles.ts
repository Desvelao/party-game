import {
  isAdminRepository,
  isMigratable,
  emptyStats,
  reviveRecord,
  type ProfileRecord,
} from '../profiles';
import { sanitizeAvatar, sanitizeColor, sanitizeLooks, sanitizeName } from '../../shared';
import { ProfileLimitError } from '../profiles';
import { MAX_BULK_BODY, type AdminRoute } from './api';

const ID_RE = /^[0-9a-f]{64}$/;
const MAX_IMPORT = 20_000;

type Sort = 'recent' | 'created' | 'wins' | 'points' | 'matches' | 'name';
const SORTS: Sort[] = ['recent', 'created', 'wins', 'points', 'matches', 'name'];

const SORT_FN: Record<Sort, (a: [string, ProfileRecord], b: [string, ProfileRecord]) => number> = {
  recent: (a, b) => b[1].lastSeen - a[1].lastSeen,
  created: (a, b) => b[1].createdAt - a[1].createdAt,
  wins: (a, b) => b[1].stats.wins - a[1].stats.wins,
  points: (a, b) => b[1].stats.points - a[1].stats.points,
  matches: (a, b) => b[1].stats.matches - a[1].stats.matches,
  name: (a, b) => a[1].name.localeCompare(b[1].name),
};

const summary = ([id, r]: [string, ProfileRecord]) => ({
  id,
  name: r.name,
  color: r.color,
  createdAt: r.createdAt,
  lastSeen: r.lastSeen,
  matches: r.stats.matches,
  wins: r.stats.wins,
  points: r.stats.points,
  gamesPlayed: r.stats.gamesPlayed,
});

const intParam = (v: string | null, def: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Search, edit, reset, delete, export and import player profiles. */
export const profileRoutes: AdminRoute = async (ctx, method, path) => {
  if (path !== '/profiles' && !path.startsWith('/profiles/')) return false;
  const repo = ctx.profiles;
  if (!isMigratable(repo)) {
    ctx.json(501, { error: 'this profile store cannot be listed' });
    return true;
  }

  if (method === 'GET' && path === '/profiles') {
    const q = (ctx.url.searchParams.get('q') ?? '').trim().toLowerCase();
    const sortParam = ctx.url.searchParams.get('sort') as Sort | null;
    const sort: Sort = sortParam && SORTS.includes(sortParam) ? sortParam : 'recent';
    const offset = intParam(ctx.url.searchParams.get('offset'), 0, 0, 1_000_000);
    const limit = intParam(ctx.url.searchParams.get('limit'), 50, 1, 200);
    const all = await repo.entries();
    const hits = q ? all.filter(([id, r]) => r.name.toLowerCase().includes(q) || id.startsWith(q)) : all;
    hits.sort(SORT_FN[sort]);
    ctx.json(200, {
      total: all.length,
      matched: hits.length,
      profiles: hits.slice(offset, offset + limit).map((e) => ({
        ...summary(e),
        banned: ctx.bans.isBanned('profile', e[0]),
        shadowBanned: e[1].shadowBanned === true,
      })),
    });
    return true;
  }

  if (method === 'GET' && path === '/profiles/export') {
    const all = await repo.entries();
    ctx.audit.record({ action: 'profiles.export', ip: ctx.ip, detail: { count: all.length } });
    ctx.json(200, { version: 1, profiles: Object.fromEntries(all) });
    return true;
  }

  if (method === 'POST' && path === '/profiles/import') {
    const body = await ctx.body(MAX_BULK_BODY);
    if (!body) return true;
    const src = body.profiles;
    if (typeof src !== 'object' || src === null || Array.isArray(src)) {
      ctx.json(400, { error: 'profiles object required' });
      return true;
    }
    const entries = Object.entries(src as Record<string, unknown>);
    if (entries.length > MAX_IMPORT) {
      ctx.json(413, { error: `at most ${MAX_IMPORT} profiles per import` });
      return true;
    }
    const now = Date.now();
    let imported = 0;
    let skipped = 0;
    let full = false;
    for (const [id, raw] of entries) {
      const rec = ID_RE.test(id) ? reviveRecord(raw, now) : null;
      if (!rec) {
        skipped++;
        continue;
      }
      try {
        await repo.importRecord(id, rec);
        imported++;
      } catch (err) {
        if (!(err instanceof ProfileLimitError)) throw err;
        full = true;
        skipped++;
      }
    }
    ctx.audit.record({ action: 'profiles.import', ip: ctx.ip, detail: { imported, skipped } });
    ctx.json(200, { ok: true, imported, skipped, ...(full ? { storeFull: true } : {}) });
    return true;
  }

  const m = /^\/profiles\/([0-9a-fA-F]+)(?:\/([a-z-]+))?$/.exec(path);
  if (!m) return false;
  const id = m[1]!.toLowerCase();
  const action = m[2];
  if (!ID_RE.test(id)) {
    ctx.json(400, { error: 'invalid profile id' });
    return true;
  }
  const rec = await repo.get(id);
  if (!rec) {
    ctx.json(404, { error: 'no such profile' });
    return true;
  }

  if (method === 'GET' && !action) {
    ctx.json(200, { id, profile: rec, banned: ctx.bans.isBanned('profile', id) });
    return true;
  }
  if (method === 'PATCH' && !action) {
    const body = await ctx.body();
    if (!body) return true;
    const patch: Parameters<typeof repo.upsert>[1] = {};
    const invalid: string[] = [];
    if (body.name !== undefined) {
      const name = sanitizeName(body.name);
      if (typeof body.name === 'string' && (name !== 'Player' || body.name.trim() === 'Player')) patch.name = name;
      else invalid.push('name');
    }
    if (body.color !== undefined) {
      if (sanitizeColor(body.color) === body.color) patch.color = body.color as number;
      else invalid.push('color');
    }
    if (body.looks !== undefined) {
      // every model and slot sent must survive the sanitizer unchanged (slots left out keep their default)
      const looks = sanitizeLooks(body.looks);
      const src = body.looks as Record<string, unknown>;
      const ok =
        typeof src === 'object' &&
        src !== null &&
        !Array.isArray(src) &&
        Object.entries(src).every(([model, look]) => {
          const got = looks[model];
          return !!got && typeof look === 'object' && look !== null && !Array.isArray(look) && Object.entries(look).every(([slot, v]) => got[slot] === v);
        });
      if (ok) patch.looks = looks;
      else invalid.push('looks');
    }
    if (body.avatar !== undefined) {
      if (body.avatar === null) patch.avatar = '';
      else if (sanitizeAvatar(body.avatar) === body.avatar) patch.avatar = body.avatar as string;
      else invalid.push('avatar');
    }
    if (body.shadowBanned !== undefined) {
      if (typeof body.shadowBanned === 'boolean') patch.shadowBanned = body.shadowBanned;
      else invalid.push('shadowBanned');
    }
    if (invalid.length > 0) {
      ctx.json(400, { error: `invalid ${invalid.join(', ')}` });
      return true;
    }
    const fields = Object.keys(patch);
    if (fields.length === 0) {
      ctx.json(400, { error: 'name, color, looks, avatar or shadowBanned required' });
      return true;
    }
    const next = await repo.upsert(id, patch);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const f of fields) {
      before[f] = rec[f as keyof typeof rec];
      after[f] = next[f as keyof typeof next];
    }
    ctx.events?.emit('profileChanged', () => ({ profileId: id, reason: 'admin' }));
    ctx.audit.record({ action: 'profile.edit', target: id, ip: ctx.ip, detail: { fields, before, after } });
    ctx.json(200, { profile: next });
    return true;
  }
  if (method === 'POST' && action === 'reset-stats') {
    await repo.importRecord(id, { ...rec, stats: emptyStats() });
    ctx.events?.emit('profileChanged', () => ({ profileId: id, reason: 'admin' }));
    ctx.audit.record({ action: 'profile.reset-stats', target: id, ip: ctx.ip });
    ctx.json(200, { ok: true });
    return true;
  }
  if (method === 'DELETE' && !action) {
    if (!isAdminRepository(repo)) {
      ctx.json(501, { error: 'this profile store cannot delete' });
      return true;
    }
    await repo.delete(id);
    ctx.events?.emit('profileChanged', () => ({ profileId: id, reason: 'admin' }));
    ctx.audit.record({ action: 'profile.delete', target: id, ip: ctx.ip, detail: { name: rec.name } });
    ctx.json(200, { ok: true });
    return true;
  }
  return false;
};
