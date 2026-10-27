import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PLUGIN_API_VERSION, PROTOCOL_VERSION, type ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import { loadPlugins } from '../plugins/features';
import { sha256 } from '../plugins/pack';
import { MemoryProfileRepository } from '../profiles';
import { startServer } from './server';

const base: ServerConfig = {
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
  trustProxy: false,
  publicUrl: '',
  captivePortal: false,
  consoleMode: true, consoleScreenAny: false,
  adminInsights: true,
  adminToken: 'secret',
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
  closed: Promise<number>;
  private waiters: (() => void)[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
    ws.on('error', () => {});
    this.closed = new Promise((r) => ws.on('close', (code) => r(code)));
  }
  opened() {
    return new Promise<this>((res, rej) => {
      this.ws.once('open', () => res(this));
      this.ws.once('error', rej);
    });
  }
  send(o: unknown) {
    this.ws.send(JSON.stringify(o));
  }
  async next<T extends ServerMessage['t']>(t: T, ms = 3000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t);
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

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met');
    await new Promise((r) => setTimeout(r, 5));
  }
}


const join = (extra: Record<string, unknown> = {}) => ({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'P', ...extra });

describe('console mode', () => {
  let srv: ReturnType<typeof startServer>;
  let port: number;
  const conns: Conn[] = [];

  const boot = async (over: Partial<ServerConfig> = {}, plugins?: Awaited<ReturnType<typeof loadPlugins>>) => {
    srv = startServer({ ...base, ...over }, { profiles: new MemoryProfileRepository(), plugins });
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
  };
  const open = async () => {
    const c = new Conn(new WebSocket(`ws://127.0.0.1:${port}/ws`));
    conns.push(c);
    return c.opened();
  };
  const api = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init);
  const pair = (pin: string) => api('/api/console/pair', { method: 'POST', body: JSON.stringify({ pin }) });
  const screen = async () => {
    const tv = await open();
    tv.send(join({ screen: true }));
    const w = await tv.next('WELCOME');
    return { tv, w };
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const c of conns.splice(0)) c.ws.terminate();
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  it('is off by default: no screen room, no pairing', async () => {
    await boot({ consoleMode: false });
    const tv = await open();
    tv.send(join({ screen: true }));
    expect((await tv.next('ERROR')).code).toBe('BAD_STATE');
    expect((await pair('123456')).status).not.toBe(200);
    expect((await api('/api/admin/console', { headers: { authorization: 'Bearer secret' } })).status).toBe(404);
  });

  it('the screen owns an empty room that outlives the idle timer', async () => {
    await boot({ idleRoomSeconds: 1 });
    const { w } = await screen();
    expect(w.spectator).toBe(true);
    await new Promise((r) => setTimeout(r, 1300));
    expect(srv.rooms.get(w.code)).toBeDefined();
  });

  it('only the machine itself may open the TV room, unless allowed', async () => {
    await boot({ trustProxy: true });
    const far = new Conn(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'x-forwarded-for': '10.1.2.3' } }));
    conns.push(far);
    await far.opened();
    far.send(join({ screen: true }));
    expect((await far.next('ERROR')).code).toBe('BAD_STATE');
    expect((await fetch(`http://127.0.0.1:${port}/api/console/screen`, { headers: { 'x-forwarded-for': '10.1.2.3' } })).status).toBe(403);
  });

  it('consoleScreenAny lets any address open it', async () => {
    await boot({ trustProxy: true, consoleScreenAny: true });
    const far = new Conn(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'x-forwarded-for': '10.1.2.3' } }));
    conns.push(far);
    await far.opened();
    far.send(join({ screen: true }));
    expect((await far.next('WELCOME')).spectator).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/api/console/screen`, { headers: { 'x-forwarded-for': '10.1.2.3' } })).status).toBe(200);
  });

  it('a reloaded screen re-attaches to the same room', async () => {
    await boot();
    const a = await screen();
    const b = await screen();
    expect(b.w.code).toBe(a.w.code);
  });

  it('does not pair, nor count guesses, while no TV is connected', async () => {
    await boot();
    for (let i = 0; i < 12; i++) expect((await pair('123456')).status).toBe(409);
    const { w } = await screen();
    const shown = (await (await api('/api/console/screen')).json()) as { pin: string; code: string };
    expect(shown.code).toBe(w.code);
    expect((await pair(shown.pin)).status).toBe(200);
  });

  it('pairs with the PIN only, and rate limits wrong guesses', async () => {
    await boot();
    const { w } = await screen();
    const shown = (await (await api('/api/console/screen')).json()) as { pin: string; code: string };
    expect(shown.code).toBe(w.code);
    expect((await pair('000000' === shown.pin ? '000001' : '000000')).status).toBe(401);
    const ok = await pair(shown.pin);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { token: string; code: string };
    expect(body.code).toBe(w.code);
    expect(body.token).toMatch(/^[0-9a-f]{48}$/);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await pair('abcdef')).status;
    expect(last).toBe(429);
  });

  it('a paired phone hosts without a seat; players stay guests', async () => {
    await boot();
    const { w } = await screen();
    const { pin } = (await (await api('/api/console/screen')).json()) as { pin: string };
    const { token } = (await (await pair(pin)).json()) as { token: string };

    const phone = await open();
    phone.send(join({ code: w.code, spectate: true, console: token }));
    const pw = await phone.next('WELCOME');
    expect(pw.spectator).toBe(true);
    await until(() => srv.rooms.get(w.code)!.hostId === pw.id);

    const guest = await open();
    guest.send(join({ code: w.code }));
    const gw = await guest.next('WELCOME');
    const room = srv.rooms.get(w.code)!;
    expect(room.hostId).toBe(pw.id);
    expect(room.hostId).not.toBe(gw.id);

    // the controller can use host powers
    phone.send({ t: 'ROOM_SETTINGS', locked: true });
    await until(() => room.locked);
    // and start the match without being ready itself
    phone.send({ t: 'START_GAME', force: true });
    await until(() => room.phase !== 'lobby');

    // a plain player cannot force the lobby; the controller can, mid-round
    guest.send({ t: 'BACK_TO_LOBBY' });
    expect((await guest.next('ERROR')).code).toBe('NOT_HOST');
    expect(room.phase).not.toBe('lobby');
    phone.send({ t: 'BACK_TO_LOBBY' });
    await until(() => room.phase === 'lobby');
    phone.send({ t: 'BACK_TO_LOBBY' });
    expect((await phone.next('ERROR')).code).toBe('BAD_STATE');
  });

  it('a paired phone token also opens the plugins\' admin routes', async () => {
    const root = mkdtempSync(pathJoin(tmpdir(), 'pgconsoleplug-'));
    try {
      const code = "export default { start() {}, http(req) { const denied = req.requireAdmin(); return denied ?? { status: 200, body: { ok: true } }; } };";
      const dir = pathJoin(root, 'echo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(pathJoin(dir, 'server.mjs'), code);
      writeFileSync(pathJoin(dir, 'plugin.json'), JSON.stringify({ kind: 'plugin', id: 'echo', name: 'Echo', version: '1.0.0', apiVersion: PLUGIN_API_VERSION, author: 'a', license: 'MIT', description: 'd', files: { 'server.mjs': sha256(Buffer.from(code)) } }));
      const plugins = await loadPlugins({ bundled: null, installed: root }, {}, () => {});
      await boot({}, plugins);
      for (let i = 0; i < 100 && !plugins.hasHttp('echo'); i++) await new Promise((r) => setTimeout(r, 10));
      await screen();
      const { pin } = (await (await api('/api/console/screen')).json()) as { pin: string };
      const { token } = (await (await pair(pin)).json()) as { token: string };
      expect((await api('/api/echo/x')).status).toBe(401);
      expect((await api('/api/echo/x', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a bad token, and the token opens the admin API', async () => {
    await boot();
    const { w } = await screen();
    const bad = await open();
    bad.send(join({ code: w.code, spectate: true, console: 'ab'.repeat(24) }));
    expect((await bad.next('ERROR')).code).toBe('BAD_STATE');

    const { pin } = (await (await api('/api/console/screen')).json()) as { pin: string };
    const { token } = (await (await pair(pin)).json()) as { token: string };
    expect((await api('/api/admin/whoami')).status).toBe(401);
    expect((await api('/api/admin/whoami', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    const c = (await (await api('/api/admin/console', { headers: { authorization: `Bearer ${token}` } })).json()) as { paired: number };
    expect(c.paired).toBe(1);
    const fresh = (await (await api('/api/admin/console/pin', { method: 'POST', headers: { authorization: 'Bearer secret' } })).json()) as { pin: string };
    expect(fresh.pin).toMatch(/^\d{6}$/);
    expect((await api('/api/admin/whoami', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200); // paired phones keep working
    const un = await api('/api/admin/console/unpair', { method: 'POST', headers: { authorization: 'Bearer secret' } });
    expect(un.status).toBe(200);
    expect((await api('/api/admin/whoami', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('the controller leaving hands the role to a player', async () => {
    await boot();
    const { w } = await screen();
    const { pin } = (await (await api('/api/console/screen')).json()) as { pin: string };
    const { token } = (await (await pair(pin)).json()) as { token: string };
    const phone = await open();
    phone.send(join({ code: w.code, spectate: true, console: token }));
    await phone.next('WELCOME');
    const guest = await open();
    guest.send(join({ code: w.code }));
    const gw = await guest.next('WELCOME');
    phone.ws.close();
    await until(() => srv.rooms.get(w.code)!.hostId === gw.id);
  });
});
