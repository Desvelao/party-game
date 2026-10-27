import { APP_VERSION } from '../../shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from '../config';
import type { Client } from '../networking/Client';
import type { ProfileRepository } from '../profiles';
import type { ServerEvents } from '../plugins/events';
import type { RoomManager } from '../rooms/RoomManager';
import type { AdminAuth } from './auth';
import type { AuditLog } from './audit';
import type { ReportLog } from './reports';
import type { BanList } from './bans';
import type { CatalogState } from './catalogState';
import type { MaintenanceState } from './maintenanceState';
import type { DefaultsState } from './defaultsState';
import type { PlaylistsState } from './playlistsState';
import type { MatchHistory } from './history';
import type { MetricsSampler } from './timeseries';
import type { RuntimeConfig } from './runtimeConfig';

const MAX_BODY = 16384;
/** Profile import carries many records. */
export const MAX_BULK_BODY = 8 * 1024 * 1024;

import type { ConsoleManager } from '../console';

export interface AdminDeps {
  cfg: ServerConfig;
  auth: AdminAuth;
  /** absent: console mode is off (the console routes answer 404) */
  console?: ConsoleManager;
  audit: AuditLog;
  /** absent: reports are disabled (the routes answer 404) */
  reports?: ReportLog;
  bans: BanList;
  rooms: RoomManager;
  profiles: ProfileRepository;
  /** absent: nobody listens (tests) */
  events?: ServerEvents;
  runtime: RuntimeConfig;
  catalog: CatalogState;
  maintenance: MaintenanceState;
  defaults: DefaultsState;
  playlists: PlaylistsState;
  /** absent: match history / metrics time series are disabled (the routes answer 404) */
  history?: MatchHistory;
  metrics?: MetricsSampler;
  /** every open socket, by connection id */
  clients: Map<string, Client>;
  /** the same snapshot /stats serves, without resetting the window */
  stats: () => unknown;
  /** installed plugins, for the Plugins tab (absent: none) */
  plugins?: () => { id: string; name: string; version: string; http: boolean; client: boolean }[];
  /** full operator status: stats + host/process sample (never served unauthenticated) */
  status: () => unknown;
}

export interface AdminContext extends AdminDeps {
  req: IncomingMessage;
  url: URL;
  ip: string;
  json(status: number, body: unknown): void;
  /** Send a plain-text body (CSV export...). */
  text(status: number, body: string, contentType: string, filename?: string): void;
  /** Parsed JSON body; sends a 400/413 itself and resolves null when it cannot be used. */
  body(maxBytes?: number): Promise<Record<string, unknown> | null>;
}

/** A route returns true once it has answered. */
export type AdminRoute = (ctx: AdminContext, method: string, path: string) => boolean | Promise<boolean>;

/**
 * Router for /api/admin/*. Feature modules register routes with `use`, so server.ts only
 * has to hand over the request. Every route sits behind `AdminAuth`.
 */
export function createAdminApi(deps: AdminDeps, routes: AdminRoute[] = []) {
  const all: AdminRoute[] = [coreRoutes, ...routes];

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const verdict = deps.auth.check(req);
    if (!verdict.ok) return send(verdict.status, { error: verdict.error });

    const ctx: AdminContext = {
      ...deps,
      req,
      url,
      ip: deps.auth.ip(req),
      json: send,
      text: (status, body, contentType, filename) => {
        res.writeHead(status, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          ...(filename ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
        });
        res.end(body);
      },
      body: (max = MAX_BODY) => readJson(req, send, max),
    };
    const path = url.pathname.replace(/^\/api\/admin/, '') || '/';
    try {
      for (const route of all) if (await route(ctx, req.method ?? 'GET', path)) return;
    } catch (err) {
      console.error('[party-game] admin api error', err);
      if (!res.headersSent) send(500, { error: 'internal error' });
      return;
    }
    send(404, { error: 'not found' });
  };
}

const coreRoutes: AdminRoute = (ctx, method, path) => {
  if (method === 'GET' && path === '/whoami') {
    ctx.json(200, { ok: true, version: APP_VERSION, tokenConfigured: !!ctx.auth.token, ip: ctx.ip, serverTime: Date.now() });
    return true;
  }
  if (method === 'GET' && path === '/stats') {
    ctx.json(200, ctx.stats());
    return true;
  }
  if (method === 'GET' && path === '/status') {
    ctx.json(200, ctx.status());
    return true;
  }
  if (method === 'GET' && path === '/audit') {
    const limit = Math.min(500, Math.max(1, Number.parseInt(ctx.url.searchParams.get('limit') ?? '100', 10) || 100));
    if (ctx.url.searchParams.get('format') === 'csv') {
      ctx.text(200, ctx.audit.toCsv(limit), 'text/csv; charset=utf-8', 'party-game-audit.csv');
    } else ctx.json(200, { entries: ctx.audit.list(limit) });
    return true;
  }
  return false;
};

function readJson(
  req: IncomingMessage,
  send: (status: number, body: unknown) => void,
  max: number,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        send(413, { error: 'too large' });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const body = JSON.parse(raw);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object');
        resolve(body as Record<string, unknown>);
      } catch {
        send(400, { error: 'invalid json' });
        resolve(null);
      }
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      resolve(null);
    });
  });
}
