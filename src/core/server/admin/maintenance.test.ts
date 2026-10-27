import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from '../networking/server';

const cfg: ServerConfig = {
  profile: 'NORMAL',
  port: 0,
  host: '127.0.0.1',
  tickRate: 30,
  networkRate: 15,
  maxPlayersPerRoom: 4,
  maxRooms: 4,
  maxSpectatorsPerRoom: 2,
  staticDir: '',
  gamesDir: '',
  bundledGamesDir: '',
  joinTimeoutMs: 0,
  pingIntervalMs: 0,
  maxConnectionsPerIp: 0,
  trustProxy: true, publicUrl: '', captivePortal: false, consoleMode: false, consoleScreenAny: false, adminInsights: true,
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

class Conn {
  msgs: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  static open(port: number): Promise<Conn> {
    const c = new Conn(new WebSocket(`ws://127.0.0.1:${port}/ws`));
    return new Promise((res, rej) => {
      c.ws.once('open', () => res(c));
      c.ws.once('error', rej);
    });
  }
  send(o: unknown) {
    this.ws.send(JSON.stringify(o));
  }
  async next<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    const deadline = Date.now() + 3000;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
      if (i >= 0) return this.msgs.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${t}`);
      await new Promise<void>((r) => {
        const to = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(to);
          r();
        });
      });
    }
  }
}

describe('admin maintenance', () => {
  let srv: ReturnType<typeof startServer>;
  let port: number;
  const conns: Conn[] = [];
  const open = async () => {
    const c = await Conn.open(port);
    conns.push(c);
    return c;
  };
  const api = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    fetch(`http://127.0.0.1:${port}/api/admin${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${init.token ?? 'tok'}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const c of conns) c.ws.terminate();
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  it('needs the admin token and validates input', async () => {
    expect((await api('/maintenance', { token: 'wrong' })).status).toBe(401);
    expect((await api('/maintenance', { method: 'PUT', body: { message: 'x' } })).status).toBe(400);
    expect((await api('/maintenance/announce', { body: { message: '  ' } })).status).toBe(400);
    expect((await api('/maintenance/announce', { body: { message: 'x', inSeconds: -1 } })).status).toBe(400);
    expect((await api('/maintenance/announce/nope', { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses new rooms while draining but lets a running room carry on', async () => {
    const host = await open();
    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Host' });
    const code = (await host.next('WELCOME')).code;

    expect((await api('/maintenance', { method: 'PUT', body: { draining: true, message: 'Back at 8' } })).status).toBe(200);
    const state = await host.next('MAINTENANCE_STATE', (m) => m.draining);
    expect(state.message).toBe('Back at 8');

    const late = await open();
    late.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Late' });
    expect((await late.next('ERROR')).code).toBe('SERVER_DRAINING');

    // joining the room that already exists still works
    const friend = await open();
    friend.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Friend', code });
    await friend.next('WELCOME');
    // a player who connects now is told at once
    expect((await friend.next('MAINTENANCE_STATE')).draining).toBe(true);

    const catalog = (await (await fetch(`http://127.0.0.1:${port}/api/catalog`)).json()) as { maintenance: { draining: boolean } };
    expect(catalog.maintenance.draining).toBe(true);

    await api('/maintenance', { method: 'PUT', body: { draining: false } });
    expect((await host.next('MAINTENANCE_STATE', (m) => !m.draining)).draining).toBe(false);
    const again = await open();
    again.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Again' });
    await again.next('WELCOME');
  });

  it('toasts an announcement and keeps a pinned one for later joiners', async () => {
    const a = await open();
    a.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A' });
    await a.next('WELCOME');
    const res = await api('/maintenance/announce', { body: { message: 'Pizza at 9', pinned: true } });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { id: string };
    expect((await a.next('NOTICE', (m) => m.message === 'Pizza at 9')).code).toBeUndefined();
    expect((await a.next('MAINTENANCE_STATE', (m) => m.banners.length === 1)).banners[0]!.message).toBe('Pizza at 9');

    const b = await open();
    expect((await b.next('MAINTENANCE_STATE')).banners[0]!.id).toBe(made.id);

    expect((await api(`/maintenance/announce/${made.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await a.next('MAINTENANCE_STATE', (m) => m.banners.length === 0)).recent[0]!.message).toBe('Pizza at 9');
    expect(((await (await api('/maintenance')).json()) as { announcements: unknown[] }).announcements).toEqual([]);
  });

  it('removes delivered announcements from the history', async () => {
    const a = await open();
    a.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A' });
    await a.next('WELCOME');
    const one = (await (await api('/maintenance/announce', { body: { message: 'Typo one' } })).json()) as { id: string };
    await a.next('MAINTENANCE_STATE', (m) => m.recent.some((r) => r.id === one.id));
    await api('/maintenance/announce', { body: { message: 'Typo two' } });
    await a.next('MAINTENANCE_STATE', (m) => m.recent.length >= 2);

    expect((await api(`/maintenance/recent/${one.id}`, { method: 'DELETE' })).status).toBe(200);
    await a.next('MAINTENANCE_STATE', (m) => m.recent.some((r) => r.message === 'Typo two') && !m.recent.some((r) => r.id === one.id));
    expect((await api('/maintenance/recent/nope', { method: 'DELETE' })).status).toBe(404);

    expect((await api('/maintenance/recent', { method: 'DELETE' })).status).toBe(200);
    expect((await a.next('MAINTENANCE_STATE', (m) => m.recent.length === 0)).recent).toEqual([]);
    expect(((await (await api('/maintenance')).json()) as { recent: unknown[] }).recent).toEqual([]);
  });
});
