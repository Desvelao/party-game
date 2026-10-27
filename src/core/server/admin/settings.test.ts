import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { MAX_OPERATOR_PLAYLISTS, PROTOCOL_VERSION, type ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from '../networking/server';

const cfg: ServerConfig = {
  profile: 'NORMAL',
  port: 0,
  host: '127.0.0.1',
  tickRate: 30,
  networkRate: 15,
  maxPlayersPerRoom: 4,
  maxRooms: 1,
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

function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    msgs.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const ready = new Promise<void>((r) => ws.once('open', () => r()));
  const next = async <T extends ServerMessage['t']>(t: T): Promise<Extract<ServerMessage, { t: T }>> => {
    const end = Date.now() + 2000;
    for (;;) {
      const i = msgs.findIndex((m) => m.t === t);
      if (i >= 0) return msgs.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > end) throw new Error(`timeout waiting for ${t}`);
      await new Promise<void>((r) => {
        const to = setTimeout(r, 100);
        waiters.push(() => {
          clearTimeout(to);
          r();
        });
      });
    }
  };
  return { ws, ready, next, send: (o: unknown) => ws.send(JSON.stringify(o)) };
}

describe('admin settings', () => {
  let srv: ReturnType<typeof startServer>;
  let port: number;
  const open: ReturnType<typeof client>[] = [];
  const connect = async () => {
    const c = client(port);
    open.push(c);
    await c.ready;
    return c;
  };
  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`http://127.0.0.1:${port}/api/admin${path}`, {
      method: init.method ?? (init.body ? 'PATCH' : 'GET'),
      headers: { Authorization: 'Bearer tok', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const c of open) c.ws.terminate();
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  it('does not mutate the caller config, and room limit changes take effect at once', async () => {
    const a = await connect();
    a.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A' });
    await a.next('WELCOME');
    const b = await connect();
    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'B' });
    expect((await b.next('ERROR')).code).toBe('SERVER_FULL');

    const res = await api('/config', { body: { maxRooms: 3 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { values: { maxRooms: number } }).values.maxRooms).toBe(3);
    expect(cfg.maxRooms).toBe(1);
    expect(srv.cfg.maxRooms).toBe(3);

    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'B' });
    await b.next('WELCOME');

    const bad = await api('/config', { body: { maxRooms: 0, port: 1 } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { errors: Record<string, string> }).errors).toMatchObject({ port: expect.any(String), maxRooms: expect.any(String) });

    const reset = await api('/config', { method: 'DELETE' });
    expect(((await reset.json()) as { values: { maxRooms: number } }).values.maxRooms).toBe(1);
  });

  it('option defaults: validated, audited, published to clients, resettable', async () => {
    const view = (await (await api('/defaults')).json()) as { games: { target: string; settings: { id: string; default: unknown }[] }[] };
    expect(view.games.find((g) => g.target === 'jungle-bonanza')!.settings.find((s) => s.id === 'timeLimit')!.default).toBe(90);

    expect((await api('/defaults', { body: { id: 'jungle-bonanza', options: { timeLimit: 9999 } } })).status).toBe(400);
    expect((await api('/defaults', { body: { id: 'jungle-bonanza', options: { timeLimit: 120 } } })).status).toBe(200);

    const pub = (await (await fetch(`http://127.0.0.1:${port}/api/catalog`)).json()) as { defaults: Record<string, Record<string, unknown>> };
    expect(pub.defaults['jungle-bonanza']).toEqual({ timeLimit: 120 });

    expect((await api('/defaults?id=jungle-bonanza', { method: 'DELETE' })).status).toBe(200);
    const after = (await (await fetch(`http://127.0.0.1:${port}/api/catalog`)).json()) as { defaults: Record<string, unknown> };
    expect(after.defaults).toEqual({});
  });

  it('playlists: add, publish to clients, hide and restore', async () => {
    const rounds = [{ game: 'box-bonanza', variant: 'jungle-bonanza', options: { timeLimit: 60 } }, { game: 'ballistix', variant: 'smashball' }];
    expect((await api('/playlists/mine', { method: 'PUT', body: { name: 'Mine', rounds: [{ game: 'nope' }] } })).status).toBe(400);
    expect((await api('/playlists/mine', { method: 'PUT', body: { name: 'Mine', rounds } })).status).toBe(200);

    const pub = (await (await fetch(`http://127.0.0.1:${port}/api/catalog`)).json()) as { playlists: { id: string; rounds: unknown[] }[] };
    expect(pub.playlists.map((p) => [p.id, p.rounds.length])).toEqual([['mine', 2]]);

    expect((await api('/playlists/nope', { method: 'DELETE' })).status).toBe(404);
    expect((await api('/playlists/mine', { method: 'DELETE' })).status).toBe(200);
    const after = (await (await fetch(`http://127.0.0.1:${port}/api/catalog`)).json()) as { playlists: unknown[] };
    expect(after.playlists).toEqual([]);
  });

  it('disabled games cannot be picked, and new rooms fall back to the default mix', async () => {
    expect((await api('/catalog', { body: { disable: ['box-bonanza', 'frost-classic'] } })).status).toBe(200);
    const pub = (await (await fetch(`http://127.0.0.1:${port}/api/catalog`)).json()) as { disabled: string[] };
    expect(pub.disabled).toEqual(['box-bonanza', 'frost-classic']);

    const view = (await (await api('/catalog')).json()) as { games: { id: string; variants: { id: string; enabled: boolean }[] }[] };
    expect(view.games.find((g) => g.id === 'frost-shove')!.variants.find((v) => v.id === 'frost-classic')!.enabled).toBe(false);

    // creating a room on a disabled game is refused outright (and creates nothing)
    for (const r of srv.rooms.all()) srv.rooms.closeRoom(r.code);
    const refused = await connect();
    refused.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'R', game: 'box-bonanza', variant: 'all' });
    const err = await refused.next('ERROR');
    expect(err.code).toBe('GAME_DISABLED');
    expect(srv.rooms.roomCount).toBe(0);

    const host = await connect();
    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'H' });
    const w = await host.next('WELCOME');
    expect(w.selection.game).toBe('mixed');

    // the host cannot switch to a disabled variant, but can pick an enabled one
    host.send({ t: 'SET_SELECTION', game: 'frost-shove', variant: 'frost-classic' });
    const refusedPick = await host.next('ERROR');
    expect(refusedPick.code).toBe('GAME_DISABLED');
    expect(refusedPick.message).toMatch(/disabled/);
    host.send({ t: 'SET_SELECTION', game: 'frost-shove', variant: 'frost-frenzy' });
    // skip the updates sent while joining
    let upd = await host.next('ROOM_UPDATE');
    while (upd.selection.variant !== 'frost-frenzy') upd = await host.next('ROOM_UPDATE');
    expect(upd.selection.game).toBe('frost-shove');

    // switching a game off resets lobbies that are set to it, and tells them
    host.send({ t: 'SET_SELECTION', game: 'spring-showdown', variant: 'all' });
    let cur = await host.next('ROOM_UPDATE');
    while (cur.selection.game !== 'spring-showdown') cur = await host.next('ROOM_UPDATE');
    const off = await api('/catalog', { body: { disable: ['spring-showdown'] } });
    expect(((await off.json()) as { roomsReset: string[] }).roomsReset).toEqual([w.code]);
    expect((await host.next('NOTICE')).message).toMatch(/changed by an administrator/);
    let back = await host.next('ROOM_UPDATE');
    while (back.selection.game !== 'mixed') back = await host.next('ROOM_UPDATE');
    expect(srv.rooms.get(w.code)!.selection.game).toBe('mixed');
    // a room that is not affected is not reported
    const again = await api('/catalog', { body: { disable: ['spring-showdown'] } });
    expect(((await again.json()) as { roomsReset: string[] }).roomsReset).toEqual([]);
    await api('/catalog', { body: { enable: ['spring-showdown'] } });

    // validation
    expect((await api('/catalog', { body: { disable: ['nope'] } })).status).toBe(400);
    expect((await api('/catalog', { body: { disabled: ['crazy-logs', 'crazy-logs', 'ballistix', 'frost-shove', 'spring-showdown', 'box-bonanza', 'sprint-smash', 'tank-wars', 'rumble-cards'] } })).status).toBe(400);
    expect((await api('/catalog', { body: { enable: ['box-bonanza', 'frost-classic'] } })).status).toBe(200);
    expect(srv.catalog.list()).toEqual([]);
  });

  it('catalog GET reports a disabled family as not enabled, and disable/enable merge with the current set', async () => {
    type View = { disabled: string[]; games: { id: string; enabled: boolean }[] };
    expect((await api('/catalog', { body: { disable: ['box-bonanza'] } })).status).toBe(200);
    // unknown ids in `enable` are ignored; `disable` is merged into the current set
    expect((await api('/catalog', { body: { disable: ['ballistix'], enable: ['not-disabled'] } })).status).toBe(200);
    expect(srv.catalog.list().sort()).toEqual(['ballistix', 'box-bonanza']);

    let view = (await (await api('/catalog')).json()) as View;
    expect(view.games.find((g) => g.id === 'box-bonanza')!.enabled).toBe(false);
    expect(view.games.find((g) => g.id === 'ballistix')!.enabled).toBe(false);
    expect(view.games.find((g) => g.id === 'frost-shove')!.enabled).toBe(true);

    // enable removes only the named id; the rest of the set is kept
    expect((await api('/catalog', { body: { enable: ['box-bonanza'] } })).status).toBe(200);
    view = (await (await api('/catalog')).json()) as View;
    expect(view.disabled).toEqual(['ballistix']);
    expect(view.games.find((g) => g.id === 'box-bonanza')!.enabled).toBe(true);
    await api('/catalog', { body: { enable: ['ballistix'] } });
    expect(srv.catalog.list()).toEqual([]);
  });

  it('DELETE /defaults with an unknown id is a harmless no-op', async () => {
    const res = await api('/defaults?id=no-such-game', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('games');
  });

  it('PUT /playlists/:id refuses a new playlist beyond the operator limit but still allows updating one', async () => {
    const rounds = [{ game: 'ballistix', variant: 'smashball' }];
    for (let i = 0; i < MAX_OPERATOR_PLAYLISTS; i++) {
      expect((await api(`/playlists/p${i}`, { method: 'PUT', body: { name: `P${i}`, rounds } })).status).toBe(200);
    }
    const over = await api('/playlists/extra', { method: 'PUT', body: { name: 'Extra', rounds } });
    expect(over.status).toBe(400);
    expect(((await over.json()) as { errors: string[] }).errors[0]).toMatch(/at most/);
    expect((await api('/playlists/p0', { method: 'PUT', body: { name: 'Renamed', rounds } })).status).toBe(200);
    for (let i = 0; i < MAX_OPERATOR_PLAYLISTS; i++) await api(`/playlists/p${i}`, { method: 'DELETE' });
  });
});
