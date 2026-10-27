import type { AdminRoute } from './api';
import { MAX_NOTICE, cleanText } from './moderation';

/** Up to a month: longer is a typo (seconds in a number field), not a plan. */
const MAX_SECONDS = 30 * 86_400;

const secondsOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_SECONDS ? Math.floor(v) : null;

/** Drain mode (no new rooms) and operator announcements. */
export const maintenanceRoutes: AdminRoute = async (ctx, method, path) => {
  if (path === '/maintenance') {
    if (method === 'GET') {
      ctx.json(200, ctx.maintenance.snapshot());
      return true;
    }
    if (method === 'PUT') {
      const body = await ctx.body();
      if (!body) return true;
      if (typeof body.draining !== 'boolean') return ctx.json(400, { error: 'draining (true or false) required' }), true;
      const message = body.message === undefined ? undefined : cleanText(body.message, MAX_NOTICE);
      ctx.maintenance.setDraining(body.draining, { message, exitWhenEmpty: body.exitWhenEmpty === true });
      ctx.audit.record({ action: 'maintenance.set', ip: ctx.ip, detail: { draining: body.draining, exitWhenEmpty: body.exitWhenEmpty === true } });
      ctx.json(200, ctx.maintenance.snapshot());
      return true;
    }
    if (method === 'DELETE') {
      ctx.maintenance.clear();
      ctx.audit.record({ action: 'maintenance.clear', ip: ctx.ip });
      ctx.json(200, ctx.maintenance.snapshot());
      return true;
    }
    return false;
  }

  if (method === 'POST' && path === '/maintenance/announce') {
    const body = await ctx.body();
    if (!body) return true;
    const message = cleanText(body.message, MAX_NOTICE);
    if (!message) return ctx.json(400, { error: 'message required' }), true;
    const inSeconds = body.inSeconds === undefined ? 0 : secondsOf(body.inSeconds);
    const durationSeconds = body.durationSeconds === undefined ? 0 : secondsOf(body.durationSeconds);
    if (inSeconds === null || durationSeconds === null) return ctx.json(400, { error: `inSeconds and durationSeconds must be 0..${MAX_SECONDS}` }), true;
    const a = ctx.maintenance.announce(message, { at: Date.now() + inSeconds * 1000, durationMs: durationSeconds * 1000, pinned: body.pinned === true });
    if (!a) return ctx.json(409, { error: 'too many announcements are waiting; remove one first' }), true;
    ctx.audit.record({ action: 'maintenance.announce', ip: ctx.ip, detail: { message, inSeconds, durationSeconds, pinned: a.pinned } });
    ctx.json(200, a);
    return true;
  }

  if (method === 'DELETE' && path === '/maintenance/recent') {
    ctx.maintenance.clearRecent();
    ctx.audit.record({ action: 'maintenance.recent.clear', ip: ctx.ip });
    ctx.json(200, ctx.maintenance.snapshot());
    return true;
  }

  const r = /^\/maintenance\/recent\/([A-Za-z0-9]+)$/.exec(path);
  if (r && method === 'DELETE') {
    if (!ctx.maintenance.removeRecent(r[1]!)) return ctx.json(404, { error: 'no such announcement' }), true;
    ctx.audit.record({ action: 'maintenance.recent.remove', ip: ctx.ip, detail: { id: r[1] } });
    ctx.json(200, ctx.maintenance.snapshot());
    return true;
  }

  const m = /^\/maintenance\/announce\/([A-Za-z0-9]+)$/.exec(path);
  if (m && method === 'DELETE') {
    if (!ctx.maintenance.remove(m[1]!)) return ctx.json(404, { error: 'no such announcement' }), true;
    ctx.audit.record({ action: 'maintenance.remove', ip: ctx.ip, detail: { id: m[1] } });
    ctx.json(200, ctx.maintenance.snapshot());
    return true;
  }
  return false;
};
