import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from '../networking/server';
import { profileIdOf } from '../profiles';

const cfg: ServerConfig = {
  profile: 'NORMAL',
  port: 0,
  host: '127.0.0.1',
  tickRate: 30,
  networkRate: 15,
  maxPlayersPerRoom: 4,
  maxRooms: 2,
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

describe('admin profiles', () => {
  let srv: ReturnType<typeof startServer>;
  let base: string;
  let port: number;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}/api/admin`;
  });

  afterAll(async () => {
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(base + path, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { Authorization: 'Bearer tok', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  const a = profileIdOf('key-a');
  const b = profileIdOf('key-b');

  it('searches, sorts and pages', async () => {
    await srv.profiles.upsert(a, { name: 'Alice' });
    await srv.profiles.upsert(b, { name: 'Bob' });
    await srv.profiles.recordResult(b, { name: 'Bob', match: { score: 9, won: true } });

    const all = (await (await api('/profiles?sort=wins')).json()) as { total: number; profiles: { id: string; name: string; wins: number }[] };
    expect(all.total).toBe(2);
    expect(all.profiles.map((p) => p.name)).toEqual(['Bob', 'Alice']);

    const q = (await (await api('/profiles?q=ali')).json()) as { matched: number; profiles: { id: string }[] };
    expect(q.matched).toBe(1);
    expect(q.profiles[0]!.id).toBe(a);
    const byId = (await (await api(`/profiles?q=${b.slice(0, 8)}`)).json()) as { profiles: { id: string }[] };
    expect(byId.profiles.map((p) => p.id)).toEqual([b]);
    const paged = (await (await api('/profiles?limit=1&offset=1&sort=name')).json()) as { profiles: { name: string }[] };
    expect(paged.profiles.map((p) => p.name)).toEqual(['Bob']);
  });

  it('edits, resets stats and deletes', async () => {
    expect((await api('/profiles/nothex')).status).toBe(404);
    expect((await api(`/profiles/${'0'.repeat(64)}`)).status).toBe(404);

    const patched = await api(`/profiles/${b}`, { method: 'PATCH', body: { name: '  Robert<script> ' } });
    expect(((await patched.json()) as { profile: { name: string } }).profile.name).toBe('Robertscript');

    for (const bad of [{}, { name: 5 }, { name: '<>' }, { color: 999 }, { color: '1' }, { looks: 'x' }, { looks: { blob: { hat: 999 } } }, { looks: { blob: 3 } }, { looks: { 'Not Id': { a: 1 } } }, { avatar: 'Bad Id' }, { avatar: 3 }]) {
      expect((await api(`/profiles/${b}`, { method: 'PATCH', body: bad })).status).toBe(400);
    }
    expect(((await srv.profiles.get(b))!).name).toBe('Robertscript');

    const dressed = await api(`/profiles/${b}`, { method: 'PATCH', body: { looks: { blob: { hat: 2 } }, avatar: 'blob' } });
    expect(dressed.status).toBe(200);
    expect(((await srv.profiles.get(b))!)).toMatchObject({ looks: { blob: { hat: 2 } }, avatar: 'blob' });
    expect((await api(`/profiles/${b}`, { method: 'PATCH', body: { avatar: null } })).status).toBe(200);
    expect(((await srv.profiles.get(b))!).avatar).toBeUndefined();

    expect((await api(`/profiles/${b}/reset-stats`, { body: {} })).status).toBe(200);
    expect(((await srv.profiles.get(b))!).stats.wins).toBe(0);

    expect((await api(`/profiles/${b}`, { method: 'DELETE' })).status).toBe(200);
    expect(await srv.profiles.get(b)).toBeNull();
    expect((await api(`/profiles/${b}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('round-trips export and import, skipping junk', async () => {
    const exported = (await (await api('/profiles/export')).json()) as { profiles: Record<string, unknown> };
    expect(Object.keys(exported.profiles)).toEqual([a]);

    const c = profileIdOf('key-c');
    const res = await api('/profiles/import', {
      body: { profiles: { ...exported.profiles, [c]: { name: 'Carl', stats: { wins: 3 } }, 'not-an-id': { name: 'x' }, [profileIdOf('d')]: 5 } },
    });
    expect(await res.json()).toEqual({ ok: true, imported: 2, skipped: 2 });
    expect((await srv.profiles.get(c))!.stats.wins).toBe(3);
  });

  it('a banned profile cannot join', async () => {
    const key = 'ab'.repeat(16);
    const id = profileIdOf(key);
    await srv.profiles.upsert(id, { name: 'Troll' });
    const ban = await api('/bans', { body: { profileId: id, reason: 'x' } });
    expect(ban.status).toBe(200);
    const listed = (await (await api('/profiles?q=troll')).json()) as { profiles: { banned: boolean }[] };
    expect(listed.profiles[0]!.banned).toBe(true);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const first = new Promise<{ t: string; code?: string }>((res) => ws.once('message', (d) => res(JSON.parse(d.toString()))));
    const closed = new Promise<number>((res) => ws.once('close', (c) => res(c)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Troll', profileKey: key }));
    expect(await first).toMatchObject({ t: 'ERROR', code: 'BANNED' });
    expect(await closed).toBe(1008);
  });
});
