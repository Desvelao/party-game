// Server half of the leaderboard plugin: GET /api/leaderboard ranks the stored profiles (never their keys) by wins,
// points or win rate, over all time or the last 7 / 30 days, for every game or one, with a name search.
import { apiLimiter } from '../../../core/shared/kit/ratelimit';
import type { PluginHost, PluginHttpRequest, PluginHttpResponse, ServerPlugin } from '../../../core/shared';
import { rankProfiles, searchLeaderboard, type LeaderboardPeriod, type LeaderboardRow, type LeaderboardSort } from './rank';

// ranked profiles are rebuilt at most every few seconds: the list scans the whole store
const TTL_MS = 5000;
const MAX_CACHED = 64;

let host: PluginHost | null = null;
let cache = new Map<string, { at: number; rows: LeaderboardRow[] }>();
const limiter = apiLimiter();

async function handle(h: PluginHost, req: PluginHttpRequest): Promise<PluginHttpResponse | undefined> {
  if (req.kind !== 'api' || req.path !== '/') return undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') return { status: 405, body: { error: 'method not allowed' } };
  if (!limiter.allow(req.ip)) return { status: 429, body: { error: 'rate limited' } };
  const sort: LeaderboardSort = req.query.sort === 'points' || req.query.sort === 'winrate' ? req.query.sort : 'wins';
  const period: LeaderboardPeriod = req.query.period === 'week' || req.query.period === 'month' ? req.query.period : 'all';
  // a game family id or a single variant id; anything else is ignored (whole profile)
  const gameParam = req.query.game ?? '';
  const gameIds = gameParam ? h.games.playableIds(gameParam) : null;
  const game = gameIds ? gameParam : '';
  // eslint-disable-next-line no-control-regex
  const q = (req.query.q ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  const key = `${sort}|${game}|${period}`;
  let ranked = cache.get(key);
  if (!ranked || Date.now() - ranked.at >= TTL_MS) {
    let all;
    try {
      all = await h.profiles.list();
    } catch {
      return { status: 500, body: { error: 'could not read profiles' } };
    }
    if (!all) return { status: 501, body: { error: 'this profile store cannot be listed' } };
    ranked = { at: Date.now(), rows: rankProfiles(all, { sort, period, ...(gameIds ? { games: gameIds } : {}) }) };
    if (cache.size >= MAX_CACHED) cache.clear(); // bounded: a handful of real combinations
    cache.set(key, ranked);
  }
  const rows = ranked.rows;
  return {
    status: 200,
    body: { sort, period, ...(game ? { game } : {}), total: rows.length, top: rows.slice(0, Number(h.config.top)), ...(q ? { q, results: searchLeaderboard(rows, q) } : {}) },
  };
}

const plugin: ServerPlugin = {
  start(h) {
    host = h;
    cache = new Map();
    limiter.clear();
  },
  stop() {
    host = null;
  },
  http: (req) => (host ? handle(host, req) : undefined),
};
export default plugin;
