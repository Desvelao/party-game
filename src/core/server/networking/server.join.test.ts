import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import { MemoryProfileRepository, profileIdOf } from '../profiles';
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
  captivePortal: false, consoleMode: false, consoleScreenAny: false,
  adminInsights: true,
  adminToken: '',
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

/** A repository whose get() the test resolves by hand. */
class GatedProfiles extends MemoryProfileRepository {
  gate: 'open' | 'manual' | 'never' = 'open';
  pending: (() => void)[] = [];
  async get(id: string) {
    if (this.gate === 'never') return new Promise<never>(() => {});
    if (this.gate === 'manual') await new Promise<void>((r) => this.pending.push(r));
    return super.get(id);
  }
  release() {
    this.pending.splice(0).forEach((r) => r());
  }
}

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

const KEY = 'ab'.repeat(16);
const join = (extra: Record<string, unknown> = {}) => ({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'P', ...extra });

describe('server join flow, early rejections and liveness', () => {
  let srv: ReturnType<typeof startServer>;
  let port: number;
  let profiles: GatedProfiles;
  const conns: Conn[] = [];

  const boot = async (over: Partial<ServerConfig> = {}) => {
    profiles = new GatedProfiles();
    srv = startServer({ ...base, ...over }, { profiles });
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
  };
  const open = async (opts?: ConstructorParameters<typeof WebSocket>[2]) => {
    const c = new Conn(new WebSocket(`ws://127.0.0.1:${port}/ws`, opts));
    conns.push(c);
    return c.opened();
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

  it('lists only open public rooms on /api/rooms', async () => {
    await boot();
    const mk = async (extra: Record<string, unknown>) => {
      const c = await open();
      c.send(join(extra));
      return (await c.next('WELCOME')).code;
    };
    const pub = await mk({ public: true });
    await mk({});
    await mk({ public: true, password: 'pw' });
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/rooms`)).json()) as { rooms: { code: string; passwordProtected: boolean }[] };
    expect(body.rooms.map((r) => r.code).sort()).toHaveLength(2);
    expect(body.rooms.some((r) => r.code === pub && !r.passwordProtected)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('pw');
  });

  it('rejects a banned IP (via trusted X-Forwarded-For) with BANNED and 1008', async () => {
    await boot({ trustProxy: true });
    srv.bans.add('ip', '9.9.9.9');
    const c = await open({ headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect((await c.next('ERROR')).code).toBe('BANNED');
    expect(await c.closed).toBe(1008);
    // another address is unaffected
    const ok = await open({ headers: { 'x-forwarded-for': '8.8.8.8' } });
    ok.send(join());
    await ok.next('WELCOME');
  });

  it('enforces the per-IP connection cap with 1013 and frees the slot on close', async () => {
    await boot({ maxConnectionsPerIp: 1 });
    const a = await open();
    const b = await open();
    expect(await b.closed).toBe(1013);
    a.ws.close();
    await a.closed;
    await until(() => srv.wss.clients.size === 0);
    const c = await open();
    c.send(join());
    await c.next('WELCOME');
  });

  it('closes a socket that never joins (join timeout), but not one that joined', async () => {
    await boot({ joinTimeoutMs: 150 });
    const idle = await open();
    const joined = await open();
    joined.send(join());
    await joined.next('WELCOME');
    expect(await idle.closed).toBe(1008);
    expect(joined.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('ping liveness: terminates a peer that stops answering, keeps a responsive one', async () => {
    await boot({ pingIntervalMs: 60 });
    const good = await open();
    const mute = await open({ autoPong: false } as never);
    // ws only auto-replies to pings itself; a muted client never pongs
    await mute.closed;
    expect(good.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('profile lookup: a second JOIN while looking up is BAD_STATE, then the saved look applies', async () => {
    await boot();
    await profiles.upsert(profileIdOf(KEY), { name: 'Zed', color: 6 });
    profiles.gate = 'manual';
    const c = await open();
    c.send(join({ profileKey: KEY }));
    c.send(join({ profileKey: KEY }));
    expect((await c.next('ERROR')).code).toBe('BAD_STATE');
    expect(srv.rooms.roomCount).toBe(0);
    await until(() => profiles.pending.length === 1);
    profiles.release();
    await c.next('WELCOME');
    const upd = await c.next('ROOM_UPDATE');
    expect(upd.players[0]).toMatchObject({ color: 6 });
    expect(profiles.pending).toHaveLength(0);
  });

  it('profile lookup: a hung store times out and the player joins as a guest', async () => {
    await boot();
    profiles.gate = 'never';
    const c = await open();
    const t0 = Date.now();
    c.send(join({ profileKey: KEY }));
    await c.next('WELCOME', 4000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
  });

  it('profile lookup: a socket closed mid-lookup creates no room', async () => {
    await boot();
    profiles.gate = 'manual';
    const c = await open();
    c.send(join({ profileKey: KEY }));
    await until(() => profiles.pending.length === 1);
    c.ws.close();
    await c.closed;
    profiles.release();
    await new Promise((r) => setTimeout(r, 50));
    expect(srv.rooms.roomCount).toBe(0);
  });

  it('a banned profile is rejected before the lookup', async () => {
    await boot();
    srv.bans.add('profile', profileIdOf(KEY));
    profiles.gate = 'manual';
    const c = await open();
    c.send(join({ profileKey: KEY }));
    expect((await c.next('ERROR')).code).toBe('BANNED');
    expect(await c.closed).toBe(1008);
    expect(profiles.pending).toHaveLength(0);
  });

  // KNOWN GAP (reported, not fixed): the ban is checked before the lookup only, so a ban
  // issued while the lookup is in flight still lets the player into a room.
  it.fails('a profile banned during the lookup does not get into a room', async () => {
    await boot();
    profiles.gate = 'manual';
    const c = await open();
    c.send(join({ profileKey: KEY }));
    await until(() => profiles.pending.length === 1);
    srv.bans.add('profile', profileIdOf(KEY));
    profiles.release();
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.rooms.roomCount).toBe(0);
  });

  it('/api/profile: oversized PUT is 413 and the per-IP budget yields 429', async () => {
    await boot();
    const url = `http://127.0.0.1:${port}/api/profile`;
    const auth = { Authorization: `Bearer ${KEY}` };
    const big = await fetch(url, { method: 'PUT', headers: auth, body: 'x'.repeat(40000) }).catch(() => null);
    // the server may reset the connection after replying; both mean the body was refused
    expect(big === null || big.status === 413).toBe(true);
    expect((await fetch(url)).status).toBe(401);
    let last = 0;
    for (let i = 0; i < 70 && last !== 429; i++) last = (await fetch(url, { headers: auth })).status;
    expect(last).toBe(429);
  });
});
