// Server half of the progression plugin: XP, levels, win streaks, best places and achievements, kept in the plugin's own
// file and fed by the server's `resultRecorded` event. The core's profile stats are not touched.
//   POST /api/progression  { key }            -> the caller's own progress (the key is their profile key)
//   GET  /api/progression                      -> admin: every player's progress (highest level first, ?limit=N)
//   GET  /api/progression/<profileId>          -> admin: one player
//   POST /api/progression/<profileId>/reset    -> admin: forget one player's progress
//   GET  /plugins/progression/                 -> admin page (it holds no data; its calls need the admin token)
import { createHash } from 'node:crypto';
import { apiLimiter } from '../../../core/shared/kit/ratelimit';
import type { PluginHost, PluginHttpRequest, PluginHttpResponse, ServerPlugin } from '../../../core/shared';
import { adminPage } from './page';
import { applyEvent, emptyProgress, viewOf, type ProgressEvent } from './progress';
import { ProgressStore } from './store';

/** the shape of a profile key (a plugin may not import the core's own copy) */
const PROFILE_KEY_RE = /^[0-9a-f]{32,64}$/;
const MAX_LIST = 500;

let store = new ProgressStore(null);
const limiter = apiLimiter();
let stopListening: (() => void) | null = null;

const idOf = (key: string): string => createHash('sha256').update(key).digest('hex');

/** Fold a recorded result into the player's progress. */
export function record(profileId: string, ev: ProgressEvent, now: number = Date.now()): void {
  applyEvent(store.ensure(profileId), ev, now);
  store.touch();
}

function list(req: PluginHttpRequest): PluginHttpResponse {
  const limit = Math.min(MAX_LIST, Math.max(1, Math.floor(Number(req.query.limit)) || 100));
  // level follows XP, so this is also the order by level
  const rows = [...store.entries()]
    .sort((a, b) => b[1].xp - a[1].xp || b[1].wins - a[1].wins)
    .slice(0, limit)
    .map(([id, p]) => ({ id, ...viewOf(p), achievements: Object.keys(p.achievements).length }));
  return { status: 200, body: { total: store.size, players: rows } };
}

function handle(req: PluginHttpRequest): PluginHttpResponse | undefined {
  if (req.kind === 'page') {
    if (req.path !== '/' && req.path !== '/index.html') return undefined;
    return { status: 200, type: 'text/html; charset=utf-8', body: adminPage('/api/progression') };
  }
  if (req.kind !== 'api') return undefined;
  if (req.path === '/') {
    if (req.method === 'POST') {
      if (!limiter.allow(req.ip)) return { status: 429, body: { error: 'rate limited' } };
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      if (!PROFILE_KEY_RE.test(key)) return { status: 401, body: { error: 'missing or invalid profile key' } };
      return { status: 200, body: viewOf(store.get(idOf(key)) ?? emptyProgress()) };
    }
    if (req.method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
    return req.requireAdmin() ?? list(req);
  }
  const m = /^\/([0-9a-f]{64})(\/reset)?$/.exec(req.path);
  if (!m) return undefined;
  const denied = req.requireAdmin();
  if (denied) return denied;
  const id = m[1]!;
  const p = store.get(id);
  if (m[2]) {
    if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
    return store.delete(id) ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'no progress for that profile' } };
  }
  if (req.method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
  return p ? { status: 200, body: { id, ...viewOf(p) } } : { status: 404, body: { error: 'no progress for that profile' } };
}

const plugin: ServerPlugin = {
  start(host: PluginHost) {
    store = new ProgressStore(host.dataDir);
    limiter.clear();
    stopListening = host.events.on('resultRecorded', (e) => {
      if (e.game) record(e.profileId, { game: e.game });
      else if (e.match) record(e.profileId, { match: e.match });
    });
  },
  stop() {
    stopListening?.();
    stopListening = null;
    store.flush();
  },
  http: handle,
};
export default plugin;
