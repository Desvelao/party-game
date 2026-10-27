import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from '../networking/server';

const cfg: ServerConfig = {
  profile: 'NORMAL',
  port: 0,
  host: '127.0.0.1',
  tickRate: 30,
  networkRate: 15,
  maxPlayersPerRoom: 2,
  maxRooms: 1,
  maxSpectatorsPerRoom: 1,
  staticDir: '',
  gamesDir: '',
  bundledGamesDir: '',
  joinTimeoutMs: 0,
  pingIntervalMs: 0,
  maxConnectionsPerIp: 0,
  trustProxy: false,
  publicUrl: '',
  captivePortal: false, consoleMode: false, consoleScreenAny: false,
  adminInsights: true,
  adminToken: 'tok',
  idleRoomSeconds: 0,
  roomRestoreSeconds: 0,
  idleWarnSeconds: 60,
  hostIdleSeconds: 0,
  reconnectGraceSeconds: 60,
  profileStore: 'memory',
  dataDir: '',
  sqlitePath: '',
  sqliteBusyTimeoutMs: 5000,
  maxProfiles: 100,
  recentMatches: 10,
  brandName: 'Party Game',
  welcomeMessage: '',
  pluginsDir: '',
  bundledPluginsDir: '',
  pluginsEnabled: 'all',
};

describe('/api/admin', () => {
  let srv: ReturnType<typeof startServer>;
  let base: string;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  const call = (path: string, token?: string) =>
    fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  it('rejects calls without the token', async () => {
    expect((await call('/api/admin/whoami')).status).toBe(401);
    expect((await call('/api/admin/whoami', 'wrong')).status).toBe(401);
  });

  it('serves whoami, stats and audit with the token', async () => {
    const who = await call('/api/admin/whoami', 'tok');
    expect(((await who.clone().json()) as { version: string }).version).toBe(APP_VERSION);
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({ ok: true, tokenConfigured: true });

    const stats = await (await call('/api/admin/stats', 'tok')).json();
    expect(stats).toMatchObject({ maxRooms: 1, rooms: 0 });

    expect((await call('/api/admin/status')).status).toBe(401);
    const status = await (await call('/api/admin/status', 'tok')).json();
    expect(status).toMatchObject({ maxRooms: 1, version: APP_VERSION });
    expect(status.system.memTotalMB).toBeGreaterThan(0);

    srv.audit.record({ action: 'test', ip: '127.0.0.1' });
    const audit = await (await call('/api/admin/audit?limit=5', 'tok')).json();
    expect(audit.entries[0]).toMatchObject({ action: 'test' });
  });

  it('answers 404 for unknown admin routes', async () => {
    expect((await call('/api/admin/nope', 'tok')).status).toBe(404);
  });
});
