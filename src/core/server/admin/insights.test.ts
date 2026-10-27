import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

describe('admin insights', () => {
  let srv: ReturnType<typeof startServer>;
  let base: string;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}/api/admin`;
  });

  afterAll(async () => {
    srv.loop.stop();
    srv.metrics!.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  const get = async <T>(path: string) => (await (await fetch(base + path, { headers: { Authorization: 'Bearer tok' } })).json()) as T;

  it('leaderboard and popularity come from profile stats', async () => {
    await srv.profiles.recordResult('a', { name: 'Ann', game: { id: 'smashball', place: 1, points: 10 } });
    await srv.profiles.recordResult('a', { name: 'Ann', match: { score: 10, won: true } });
    await srv.profiles.recordResult('b', { name: 'Bob', game: { id: 'smashball', place: 2, points: 7 } });
    await srv.profiles.recordResult('b', { name: 'Bob', game: { id: 'jungle-bonanza', place: 1, points: 10 } });

    const all = await get<{ leaders: { name: string; wins: number }[] }>('/leaderboard');
    expect(all.leaders[0]).toMatchObject({ name: 'Ann', wins: 1 });

    const game = await get<{ unit: string; leaders: { name: string; points: number }[] }>('/leaderboard?game=smashball&sort=points');
    expect(game.unit).toBe('rounds');
    expect(game.leaders.map((l) => l.name)).toEqual(['Ann', 'Bob']);
    const none = await get<{ leaders: unknown[] }>('/leaderboard?game=spring-painter');
    expect(none.leaders).toEqual([]);

    const pop = await get<{ games: { id: string; name: string; played: number }[] }>('/popularity');
    expect(pop.games[0]).toMatchObject({ id: 'smashball', played: 2 });
    expect(pop.games.map((g) => g.id)).toContain('jungle-bonanza');
  });

  it('serves match history and metrics', async () => {
    srv.history!.record({ ts: 1, room: 'ABCD', durationSec: 30, games: [{ id: 'g', name: 'G' }], ranking: [{ name: 'Ann', score: 10, signedIn: true }] });
    const m = await get<{ total: number; matches: { room: string }[] }>('/matches?limit=5');
    expect(m).toMatchObject({ total: 1, matches: [{ room: 'ABCD' }] });
    srv.metrics!.sample();
    const series = await get<{ points: { rooms: number }[] }>('/metrics');
    expect(series.points.length).toBeGreaterThan(0);
  });
});

describe('admin insights turned off', () => {
  it('answers 404 for history, metrics and reports and keeps the rest working', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const off = startServer({ ...cfg, adminInsights: false });
    await new Promise<void>((r) => (off.http.listening ? r() : off.http.once('listening', () => r())));
    const root = `http://127.0.0.1:${(off.http.address() as AddressInfo).port}/api/admin`;
    const get = (path: string) => fetch(root + path, { headers: { Authorization: 'Bearer tok' } });
    expect(off.history).toBeUndefined();
    expect(off.metrics).toBeUndefined();
    for (const path of ['/matches', '/metrics', '/reports']) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'unavailable' });
    }
    expect((await get('/rooms')).status).toBe(200);
    off.loop.stop();
    off.wss.close();
    await new Promise<void>((r) => off.http.close(() => r()));
  });
});
