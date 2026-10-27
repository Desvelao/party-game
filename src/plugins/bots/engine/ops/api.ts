// The management API of the bots, free of any transport: the bot server wraps it in its own HTTP listener, the bots
// plugin mounts it under /api/bots in the game server. Features the host did not switch on answer 404.
import type { AiRouter } from '../router';
import type { BotManager } from '../manager';
import type { RoomWatcher } from '../watcher';
import type { AuditLog } from './audit';
import type { MetricsSampler } from './metrics';
import { renderMetrics } from './prometheus';
import type { RuntimeConfig } from './runtime';
import type { CompanionConfig } from './settings';

export interface ApiRequest {
  method: string;
  /** relative to the API root: `/state`, `/bots/b1/stop`... */
  path: string;
  query: Record<string, string>;
  /** the JSON object sent (`{}` when there is none), null when invalid */
  body: Record<string, unknown> | null;
  ip: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  /** content type of a text body (the Prometheus exposition) */
  type?: string;
}

export interface Services {
  cfg: CompanionConfig;
  router: AiRouter;
  bots: BotManager;
  watcher: RoomWatcher;
  startedAt: number;
  /** the history and the Prometheus text; null = metrics are off */
  metrics: MetricsSampler | null;
  /** live configuration; null = off */
  runtime: RuntimeConfig | null;
  /** audit log; null = off */
  audit: AuditLog | null;
  /** is a token required of callers (the bot server's own, or the game server's admin token)? */
  tokenConfigured: boolean;
}

const ok = (body: unknown, status = 200): ApiResponse => ({ status, body });
const err = (status: number, error: string, extra: object = {}): ApiResponse => ({ status, body: { error, ...extra } });
const notFound = (): ApiResponse => err(404, 'not found');

export async function handleApi(s: Services, req: ApiRequest): Promise<ApiResponse> {
  const { path, method, ip } = req;

  if (path === '/whoami') return ok({ ok: true, tokenConfigured: s.tokenConfigured, ip });
  if (path === '/state' && method === 'GET') {
    const m = s.metrics?.latest() ?? null;
    return ok({
      now: Date.now(),
      uptimeSec: Math.round((Date.now() - s.startedAt) / 1000),
      paused: s.bots.paused,
      gameServer: { url: s.cfg.gameServer.url, up: s.watcher.serverUp, error: s.watcher.lastError, lastPoll: s.watcher.lastPoll },
      join: s.cfg.join,
      ai: { ...s.cfg.ai, games: s.router.catalog() },
      reports: s.cfg.reports,
      bots: s.bots.list(),
      rooms: s.watcher.views,
      usage: m,
      log: s.bots.log.slice(-60),
      features: { metrics: !!s.metrics, liveConfig: !!s.runtime, audit: !!s.audit },
    });
  }
  if (path === '/metrics' && method === 'GET') {
    if (!s.metrics) return notFound();
    return ok({ intervalMs: s.metrics.intervalMs, points: s.metrics.list() });
  }
  if (path === '/prometheus' && (method === 'GET' || method === 'HEAD')) {
    if (!s.metrics || !s.cfg.metrics.enabled) return notFound();
    return { status: 200, body: method === 'HEAD' ? '' : renderMetrics({ cfg: s.cfg, router: s.router, bots: s.bots, metrics: s.metrics, watcher: s.watcher, startedAt: s.startedAt }), type: 'text/plain; version=0.0.4; charset=utf-8' };
  }

  if (path === '/config') {
    const rt = s.runtime;
    if (!rt) return notFound();
    if (method === 'GET') return ok(rt.snapshot());
    if (method === 'PATCH') {
      if (!req.body) return err(400, 'expected a JSON object of at most 16 KB');
      const r = rt.patch(req.body);
      if (!r.ok) return err(400, 'invalid settings', { errors: r.errors });
      s.audit?.record({ action: 'config.set', ip, detail: req.body });
      return ok(rt.snapshot());
    }
    if (method === 'DELETE') {
      rt.reset();
      s.audit?.record({ action: 'config.reset', ip });
      return ok(rt.snapshot());
    }
  }
  if (path === '/audit' && method === 'GET') {
    if (!s.audit) return notFound();
    return ok({ entries: s.audit.list(Number(req.query.limit) || 100) });
  }

  if (method === 'POST') {
    const stop = /^\/bots\/(b\d+)\/stop$/.exec(path);
    if (stop) {
      const row = s.bots.list().find((r) => r.id === stop[1]);
      const done = s.bots.stop(stop[1]!, 'stopped from the dashboard');
      if (done) s.audit?.record({ action: 'bot.stop', ip, target: row ? `${row.name} @ ${row.room}` : stop[1] });
      return done ? ok({ ok: true }) : err(404, 'no such running bot');
    }
    const add = /^\/rooms\/([A-Za-z0-9]{4})\/bot$/.exec(path);
    if (add) {
      const body = req.body ?? {};
      const level = typeof body.level === 'string' && body.level ? body.level : undefined;
      const added = await s.watcher.addBot(add[1]!, level);
      if (!added.ok) return err(added.error.startsWith('no such room') ? 404 : 409, added.error);
      s.audit?.record({ action: 'bot.add', ip, target: `${added.bot} @ ${add[1]!.toUpperCase()}`, detail: level ? { level } : undefined });
      return ok({ ok: true, bot: added.bot });
    }
    const remove = /^\/rooms\/([A-Za-z0-9]{4})\/bots\/remove$/.exec(path);
    if (remove) {
      const n = s.watcher.removeBots(remove[1]!);
      if (n) s.audit?.record({ action: 'bots.remove', ip, target: remove[1]!.toUpperCase(), detail: { count: n } });
      return n ? ok({ ok: true, removed: n }) : err(404, 'no bots in that room');
    }
    if (path === '/pause') {
      s.bots.paused = req.query.paused !== '0';
      if (s.bots.paused) s.bots.stopAll('paused');
      s.audit?.record({ action: s.bots.paused ? 'bots.pause' : 'bots.resume', ip });
      return ok({ ok: true, paused: s.bots.paused });
    }
  }
  return notFound();
}
