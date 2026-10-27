// HTTP listener of the bot server: its own token, /healthz, the dashboard page and a thin wrapper around the management API it shares
// with the bots plugin (src/plugins/bots/engine/ops/api.ts).
// Dashboard and JSON API of the companion server. Auth is the game server's model: a bearer token (ADMIN_TOKEN);
// without one only the machine itself gets in (never through a proxy header); 10 wrong tokens per address per
// minute answer 429.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AiRouter } from '../../src/plugins/bots/engine/router';
import type { AuditLog } from '../../src/plugins/bots/engine/ops/audit';
import { handleApi } from '../../src/plugins/bots/engine/ops/api';
import { DASHBOARD_PAGE } from '../../src/plugins/bots/engine/ops/page';
import type { BotManager } from '../../src/plugins/bots/engine/manager';
import type { MetricsSampler } from '../../src/plugins/bots/engine/ops/metrics';
import type { RuntimeConfig } from '../../src/plugins/bots/engine/ops/runtime';
import type { CompanionConfig } from './settings';
import type { RoomWatcher } from '../../src/plugins/bots/engine/watcher';

export interface Services {
  cfg: CompanionConfig;
  router: AiRouter;
  bots: BotManager;
  metrics: MetricsSampler;
  watcher: RoomWatcher;
  runtime: RuntimeConfig;
  audit: AuditLog;
  startedAt: number;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
const MAX_BODY = 16 * 1024;

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** token configured: must match. none: only the machine itself (and never through a proxy header). */
export function authorized(token: string, req: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  if (token) {
    const h = req.headers.authorization;
    return typeof h === 'string' && h.startsWith('Bearer ') && same(h.slice(7), token);
  }
  return LOOPBACK.has(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 429; error: string };

/** `authorized` plus the failed-attempt limit. */
export class AuthGuard {
  private failures = new Map<string, { n: number; reset: number }>();

  constructor(private readonly token: () => string) {}

  check(req: Pick<IncomingMessage, 'headers' | 'socket'>, now = Date.now()): AuthResult {
    const token = this.token();
    const ip = req.socket.remoteAddress ?? '?';
    const f = this.failures.get(ip);
    if (f && f.reset > now && f.n >= MAX_FAILURES) return { ok: false, status: 429, error: 'too many failed attempts' };
    if (authorized(token, req)) return { ok: true };
    // a request with no credentials at all is not a guess; only wrong tokens count
    if (token && req.headers.authorization) {
      if (this.failures.size > 2000) this.failures.clear();
      if (!f || f.reset <= now) this.failures.set(ip, { n: 1, reset: now + WINDOW_MS });
      else f.n++;
    }
    const error = !token ? 'token required for non-local callers' : req.headers.authorization ? 'bad token' : 'admin token required';
    return { ok: false, status: 401, error };
  }
}

export const clientIp = (req: Pick<IncomingMessage, 'socket'>): string => req.socket.remoteAddress ?? '?';

const send = (res: ServerResponse, code: number, body: unknown): void => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createApi(s: Services): Server {
  const guard = new AuthGuard(() => s.cfg.server.adminToken);
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      res.end(DASHBOARD_PAGE);
      return;
    }
    if (url.pathname === '/healthz') return send(res, 200, { ok: true, bots: s.bots.count(), gameServer: s.watcher.serverUp });
    const isMetrics = url.pathname === '/metrics' && s.cfg.metrics.enabled;
    if (!isMetrics && !url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const auth = guard.check(req);
    if (!auth.ok) return send(res, auth.status, { error: auth.error });

    // the management API itself is shared with the bots plugin (src/plugins/bots/engine/ops/api.ts)
    const r = await handleApi(
      { ...s, tokenConfigured: !!s.cfg.server.adminToken },
      {
        method: req.method ?? 'GET',
        path: isMetrics ? '/prometheus' : url.pathname.slice('/api'.length),
        query: Object.fromEntries(url.searchParams),
        body: req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req),
        ip: clientIp(req),
      },
    );
    if (typeof r.body === 'string') {
      res.writeHead(r.status, { 'Content-Type': r.type ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : r.body);
      return;
    }
    return send(res, r.status, r.body);
  };
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[bots] request failed', err);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });
}
