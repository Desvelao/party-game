import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from './server';

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
// capacity = maxRooms * (players + spectators) = 3 sockets

class Conn {
  msgs: ServerMessage[] = [];
  closed: Promise<number>;
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closed = new Promise((r) => ws.on('close', (code) => r(code)));
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
  /** Resolve with the first not-yet-consumed message matching `pred`. */
  async next<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    const deadline = Date.now() + 2000;
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

async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('server dispatch over websocket', () => {
  let srv: ReturnType<typeof startServer>;
  let port: number;
  const conns: Conn[] = [];
  const open = async () => {
    const c = await Conn.open(port);
    conns.push(c);
    return c;
  };

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

  it('create, join, spectate, BAD_STATE/NOT_HOST, capacity close, cleanup', async () => {
    const host = await open();
    const guest = await open();
    const watcher = await open();

    // not in a room yet
    watcher.send({ t: 'START_GAME' });
    expect((await watcher.next('ERROR')).code).toBe('BAD_STATE');

    // version mismatch
    guest.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION + 1, name: 'g' });
    expect((await guest.next('ERROR')).code).toBe('BAD_VERSION');

    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Host' });
    const welcome = await host.next('WELCOME');
    expect(welcome.spectator).toBe(false);
    expect(welcome.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(srv.rooms.roomCount).toBe(1);

    // /rooms lists the room as JSON and HTML
    const listed = (await (await fetch(`http://127.0.0.1:${port}/rooms?format=json`)).json()) as { code: string }[];
    expect(listed.map((r) => r.code)).toEqual([welcome.code]);
    const html = await (await fetch(`http://127.0.0.1:${port}/rooms`)).text();
    expect(html).toContain(welcome.code);
    expect(html).toContain('id="topnav"');
    expect(html).toContain('href="/status"');

    // /status is public, so it serves only minimal data (the detail is behind admin auth)
    const status = (await (await fetch(`http://127.0.0.1:${port}/status?format=json`)).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ ok: true, rooms: 1, clients: expect.any(Number), uptimeSec: expect.any(Number) });
    expect(status).not.toHaveProperty('system');
    expect(status).not.toHaveProperty('loop');
    expect(status).not.toHaveProperty('net');
    expect(await (await fetch(`http://127.0.0.1:${port}/status`)).text()).toContain('Server status');
    expect(await (await fetch(`http://127.0.0.1:${port}/status`)).text()).toContain('href="/rooms"');

    // maxRooms=1: a second room cannot be created
    guest.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'g' });
    expect((await guest.next('ERROR')).code).toBe('SERVER_FULL');
    guest.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'g', code: 'ZZZZ' });
    expect((await guest.next('ERROR')).code).toBe('ROOM_NOT_FOUND');

    guest.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Guest', code: welcome.code });
    expect((await guest.next('WELCOME')).code).toBe(welcome.code);
    await host.next('PLAYER_JOINED', (m) => m.player.name === 'Guest');

    // non-host cannot start
    guest.send({ t: 'START_GAME' });
    expect((await guest.next('ERROR')).code).toBe('NOT_HOST');

    // double join
    guest.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Guest', code: welcome.code });
    expect((await guest.next('ERROR')).code).toBe('BAD_STATE');

    // spectator: gets WELCOME(spectator), INPUT silently dropped, other intents -> BAD_STATE
    watcher.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Eye', code: welcome.code, spectate: true });
    expect((await watcher.next('WELCOME')).spectator).toBe(true);
    watcher.send({ t: 'INPUT', seq: 1, mx: 1, my: 0, a1: false, a2: false });
    watcher.send({ t: 'READY', ready: true });
    const err = await watcher.next('ERROR');
    expect(err.code).toBe('BAD_STATE'); // from READY; INPUT produced no error
    expect(watcher.msgs.filter((m) => m.t === 'ERROR')).toHaveLength(0);

    // junk is dropped; PING answered
    watcher.ws.send('not json');
    watcher.send({ t: 'PING', ts: 7 });
    expect((await watcher.next('PONG')).ts).toBe(7);

    // at capacity (3 sockets): a 4th is closed with 1013
    const extra = await open();
    expect(await extra.closed).toBe(1013);

    // cleanup: players leaving releases the room; spectator is told it closed
    host.ws.close();
    await until(() => srv.rooms.get(welcome.code)?.connectedCount === 1);
    guest.ws.close();
    await until(() => srv.rooms.roomCount === 0);
    expect((await watcher.next('ERROR', (m) => m.code === 'ROOM_CLOSED')).code).toBe('ROOM_CLOSED');
  });

  it('profile API: auth, validation, persistence and join with a saved look', async () => {
    const base = `http://127.0.0.1:${port}/api/profile`;
    const key = 'cd'.repeat(16);
    const auth = { Authorization: `Bearer ${key}` };

    expect((await fetch(base)).status).toBe(401);
    expect((await fetch(base, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect(((await (await fetch(base, { headers: auth })).json()) as { profile: unknown }).profile).toBeNull();
    expect((await fetch(base, { method: 'POST', headers: auth })).status).toBe(405);
    expect((await fetch(base, { method: 'PUT', headers: auth, body: '{bad' })).status).toBe(400);
    expect((await fetch(base, { method: 'PUT', headers: auth, body: 'x'.repeat(20000) }).catch(() => null))?.status ?? 413).toBe(413);

    const put = await fetch(base, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ name: 'Zed', color: 6, looks: { blob: { hat: 3, hair: 99 } }, avatar: 'blob' }),
    });
    expect(put.status).toBe(200);
    const saved = ((await put.json()) as { profile: { name: string; color: number; looks: Record<string, Record<string, number>> } }).profile;
    // no model is installed in this test: the look is kept within bounds (hair 99 is not a plausible option)
    expect(saved).toMatchObject({ name: 'Zed', color: 6, looks: { blob: { hat: 3 } }, avatar: 'blob' });
    expect(saved.looks.blob.hair).toBeUndefined();

    const lang = await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ lang: 'es' }) });
    expect(((await lang.json()) as { profile: { lang: string } }).profile.lang).toBe('es');
    const bad = await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ lang: 'xx' }) });
    expect(((await bad.json()) as { profile: { lang: string } }).profile.lang).toBe('es');

    const presets = {
      variants: [{ id: 'v1', name: 'Fast Pogo', game: 'spring-showdown', variant: 'spring-painter', options: { hopTime: 0.2 } }],
      playlists: [{ id: 'p1', name: 'Mix', entries: [{ game: 'crazy-logs' }, { game: 'spring-showdown', variant: 'spring-painter' }] }],
    };
    const pre = await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ presets }) });
    expect(pre.status).toBe(200);
    const got = ((await (await fetch(base, { headers: auth })).json()) as { profile: { presets: { variants: unknown[]; playlists: { entries: unknown[] }[] } } }).profile.presets;
    expect(got.variants).toHaveLength(1);
    expect(got.playlists[0].entries).toHaveLength(2);
    // a body above the old 2 KB limit is accepted now, junk presets are dropped
    const big = { presets: { variants: Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, name: 'x'.repeat(24), game: 'nope' })) } };
    const bigPut = await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify(big) });
    expect(bigPut.status).toBe(200);
    expect(((await bigPut.json()) as { profile: { presets: { variants: unknown[] } } }).profile.presets.variants).toEqual([]);
    await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ presets }) });

    // keyboard controls: sanitized, persisted, resettable
    const ctl = await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ controls: { action: ['KeyF', 'ControlLeft'], action2: ['Tab'], up: 'x' } }) });
    expect(ctl.status).toBe(200);
    const withCtl = ((await ctl.json()) as { profile: { controls: Record<string, string[]> } }).profile.controls;
    expect(withCtl.action).toEqual(['KeyF']);
    expect(withCtl.action2).toEqual(['KeyE', 'KeyL']);
    expect(withCtl.up).toEqual(['KeyW', 'ArrowUp']);
    const cleared = await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ controls: null }) });
    expect(((await cleared.json()) as { profile: { controls?: unknown } }).profile.controls).toBeUndefined();

    // joining with the key brings the saved colour and look into the room
    const c = await open();
    c.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Zed', profileKey: key });
    await c.next('WELCOME');
    const upd = await c.next('ROOM_UPDATE');
    expect(upd.players[0]).toMatchObject({ color: 6, looks: { blob: { hat: 3 } }, avatar: 'blob' });
    c.ws.close();
    await until(() => srv.rooms.roomCount === 0);
  });

  it('early-rejected sockets already have an error listener', async () => {
    const counts: number[] = [];
    const record = (ws: WebSocket) => counts.push(ws.listenerCount('error'));
    srv.wss.on('connection', record);
    const baseline = srv.wss.clients.size;
    const held = [await open(), await open(), await open()];
    const extra = await open(); // beyond capacity: closed 1013 on the early-return path
    expect(await extra.closed).toBe(1013);
    srv.wss.off('connection', record);
    for (const c of held) c.ws.close();
    await Promise.all(held.map((c) => c.closed));
    await until(() => srv.wss.clients.size === baseline);
    expect(counts).toHaveLength(4);
    expect(counts.every((n) => n >= 1)).toBe(true);
  });

  it('host can kick: the removed socket gets KICKED and is closed', async () => {
    const host = await open();
    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'H' });
    const w = await host.next('WELCOME');
    const guest = await open();
    guest.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'G', code: w.code });
    const gw = await guest.next('WELCOME');

    guest.send({ t: 'KICK', id: w.id }); // not the host
    expect((await guest.next('ERROR')).code).toBe('NOT_HOST');

    host.send({ t: 'KICK', id: gw.id });
    expect((await guest.next('ERROR')).code).toBe('KICKED');
    expect(await guest.closed).toBe(1000);
    await until(() => srv.rooms.get(w.code)?.size === 1);

    host.ws.close();
    await until(() => srv.rooms.roomCount === 0);
  });

  it('a throw in a room handler is logged and answered with ERROR; the socket stays usable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = await open();
    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'H' });
    const w = await host.next('WELCOME');
    const room = srv.rooms.get(w.code)!;
    const boom = vi.spyOn(room, 'setReady').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    host.send({ t: 'READY', ready: true });
    expect((await host.next('ERROR')).code).toBe('BAD_STATE');
    expect(err).toHaveBeenCalled();
    boom.mockRestore();
    err.mockRestore();
    host.send({ t: 'PING', ts: 1 });
    await host.next('PONG');
    host.ws.close();
    await until(() => srv.rooms.roomCount === 0);
  });
});
