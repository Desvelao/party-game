import { CATALOG } from '../../shared';
import { isMigratable } from '../profiles';
import type { AdminContext, AdminRoute } from './api';

const intParam = (v: string | null, def: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const unavailable = (ctx: AdminContext) => {
  ctx.json(404, { error: 'unavailable' });
  return true;
};

/** Match history, leaderboards, popularity and the metrics time series. */
export const insightRoutes: AdminRoute = async (ctx, method, path) => {
  if (method !== 'GET') return false;

  if (path === '/matches') {
    if (!ctx.history) return unavailable(ctx);
    const limit = intParam(ctx.url.searchParams.get('limit'), 50, 1, 500);
    ctx.json(200, { total: ctx.history.size, playedSinceStart: ctx.history.playedSinceStart, matches: ctx.history.list(limit) });
    return true;
  }

  if (path === '/metrics') {
    if (!ctx.metrics) return unavailable(ctx);
    ctx.json(200, { intervalSec: ctx.metrics.intervalMs / 1000, points: ctx.metrics.list() });
    return true;
  }

  if (path === '/leaderboard' || path === '/popularity') {
    if (!isMigratable(ctx.profiles)) {
      ctx.json(501, { error: 'this profile store cannot be listed' });
      return true;
    }
    const all = await ctx.profiles.entries();

    if (path === '/popularity') {
      // all-time rounds played, summed over every profile's per-game stats (signed-in players only)
      const played = new Map<string, number>();
      for (const [, r] of all) for (const [id, g] of Object.entries(r.stats.games)) played.set(id, (played.get(id) ?? 0) + g.played);
      const name = new Map<string, { name: string; game: string }>();
      for (const g of CATALOG) {
        if (g.variants.length === 0) name.set(g.id, { name: g.name, game: g.id });
        for (const v of g.variants) name.set(v.id, { name: v.name, game: g.id });
      }
      const rows = [...played]
        .map(([id, n]) => ({ id, name: name.get(id)?.name ?? id, game: name.get(id)?.game ?? id, played: n }))
        .sort((a, b) => b.played - a.played);
      ctx.json(200, { basis: 'signed-in players, all time', games: rows });
      return true;
    }

    const game = ctx.url.searchParams.get('game');
    const by = ctx.url.searchParams.get('sort') === 'points' ? 'points' : 'wins';
    const limit = intParam(ctx.url.searchParams.get('limit'), 20, 1, 100);
    const rows = all
      .map(([id, r]) => {
        const s = game ? r.stats.games[game] : null;
        if (game && !s) return null;
        return {
          id,
          name: r.name,
          wins: s ? s.wins : r.stats.wins,
          points: s ? s.points : r.stats.points,
          played: s ? s.played : r.stats.matches,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b[by] - a[by] || b.played - a.played)
      .slice(0, limit);
    ctx.json(200, { game: game ?? null, sort: by, unit: game ? 'rounds' : 'matches', leaders: rows });
    return true;
  }
  return false;
};
