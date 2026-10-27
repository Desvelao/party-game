import { CATALOG, publishedSettings, type OptionValue } from '../../shared';
import type { AdminRoute } from './api';

/** Runtime configuration and the games catalog. */
export const settingsRoutes: AdminRoute = async (ctx, method, path) => {
  if (path === '/config') {
    if (method === 'GET') {
      ctx.json(200, ctx.runtime.snapshot());
      return true;
    }
    if (method === 'PATCH') {
      const body = await ctx.body();
      if (!body) return true;
      const res = ctx.runtime.patch(body);
      if (!res.ok) {
        ctx.json(400, { error: 'invalid settings', errors: res.errors });
        return true;
      }
      ctx.audit.record({ action: 'config.set', ip: ctx.ip, detail: body });
      ctx.json(200, ctx.runtime.snapshot());
      return true;
    }
    if (method === 'DELETE') {
      ctx.runtime.reset();
      ctx.audit.record({ action: 'config.reset', ip: ctx.ip });
      ctx.json(200, ctx.runtime.snapshot());
      return true;
    }
    return false;
  }

  if (path === '/defaults') {
    const snapshot = () => ({
      games: publishedSettings(),
      ...ctx.defaults.layers(),
    });
    if (method === 'GET') {
      ctx.json(200, snapshot());
      return true;
    }
    if (method === 'PATCH') {
      const body = await ctx.body();
      if (!body) return true;
      const opts = body.options;
      if (typeof body.id !== 'string' || typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
        ctx.json(400, { error: 'expected { id, options: { optionId: value | null } }' });
        return true;
      }
      const res = ctx.defaults.patch(body.id, opts as Record<string, OptionValue | null>);
      if (!res.ok) {
        ctx.json(400, { error: 'invalid defaults', errors: res.errors });
        return true;
      }
      ctx.audit.record({ action: 'defaults.set', ip: ctx.ip, detail: body });
      ctx.json(200, snapshot());
      return true;
    }
    if (method === 'DELETE') {
      ctx.defaults.reset(ctx.url.searchParams.get('id') ?? undefined);
      ctx.audit.record({ action: 'defaults.reset', ip: ctx.ip, detail: { id: ctx.url.searchParams.get('id') ?? null } });
      ctx.json(200, snapshot());
      return true;
    }
    return false;
  }

  if (path === '/playlists') {
    if (method === 'GET') {
      ctx.json(200, { playlists: ctx.playlists.list() });
      return true;
    }
    return false;
  }

  const pl = /^\/playlists\/([A-Za-z0-9_-]{1,12})(?:\/(restore))?$/.exec(path);
  if (pl) {
    const id = pl[1]!;
    const list = () => ({ playlists: ctx.playlists.list() });
    if (!pl[2] && method === 'PUT') {
      const body = await ctx.body();
      if (!body) return true;
      const res = ctx.playlists.put(id, body);
      if (!res.ok) {
        ctx.json(400, { error: 'invalid playlist', errors: res.errors });
        return true;
      }
      ctx.audit.record({ action: 'playlists.set', target: id, ip: ctx.ip, detail: { name: res.playlist.name, rounds: res.playlist.rounds.length } });
      ctx.json(200, list());
      return true;
    }
    if (!pl[2] && method === 'DELETE') {
      if (!ctx.playlists.remove(id)) return ctx.json(404, { error: 'unknown playlist' }), true;
      ctx.audit.record({ action: 'playlists.delete', target: id, ip: ctx.ip });
      ctx.json(200, list());
      return true;
    }
    if (pl[2] && method === 'POST') {
      if (!ctx.playlists.restore(id)) return ctx.json(404, { error: 'nothing to restore' }), true;
      ctx.audit.record({ action: 'playlists.restore', target: id, ip: ctx.ip });
      ctx.json(200, list());
      return true;
    }
    return false;
  }

  if (path === '/plugins') {
    if (method === 'GET') {
      ctx.json(200, { plugins: ctx.plugins?.() ?? [] });
      return true;
    }
    return false;
  }

  if (path === '/catalog') {
    if (method === 'GET') {
      const disabled = ctx.catalog.list();
      const off = new Set(disabled);
      ctx.json(200, {
        disabled,
        games: CATALOG.map((g) => ({
          id: g.id,
          name: g.name,
          enabled: !off.has(g.id),
          variants: g.variants.map((v) => ({ id: v.id, name: v.name, enabled: ctx.catalog.isPlayableEnabled(v.id) })),
        })),
      });
      return true;
    }
    if (method === 'PATCH') {
      const body = await ctx.body();
      if (!body) return true;
      const strings = (v: unknown): string[] | null =>
        v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
      let next: string[];
      if (body.disabled !== undefined) {
        const d = strings(body.disabled);
        if (!d) return ctx.json(400, { error: 'disabled must be a list of ids' }), true;
        next = d;
      } else {
        const off = strings(body.disable);
        const on = strings(body.enable);
        if (!off || !on) return ctx.json(400, { error: 'disable/enable must be lists of ids' }), true;
        const set = new Set(ctx.catalog.list());
        for (const id of off) set.add(id);
        for (const id of on) set.delete(id);
        next = [...set];
      }
      const res = ctx.catalog.set(next);
      if (!res.ok) return ctx.json(400, { error: res.error }), true;
      const reset = ctx.rooms.revalidate((sel) => ctx.catalog.check(sel));
      ctx.audit.record({ action: 'catalog.set', ip: ctx.ip, detail: { disabled: ctx.catalog.list(), roomsReset: reset } });
      ctx.json(200, { disabled: ctx.catalog.list(), roomsReset: reset });
      return true;
    }
  }
  return false;
};
