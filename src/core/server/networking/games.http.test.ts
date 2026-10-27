import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unregisterGames } from '../../shared';
import { fixturePack, FIXTURE_CLIENT } from '../../test-fixtures/pack';
import { unregisterMinigames } from '../minigames';
import { loadGames } from '../plugins/loader';
import { writePackDir } from '../plugins/pack';
import type { ServerConfig } from '../config';
import { startServer } from './server';

const cfg: ServerConfig = {
  profile: 'NORMAL', port: 0, host: '127.0.0.1', tickRate: 30, networkRate: 15, maxPlayersPerRoom: 2, maxRooms: 1,
  maxSpectatorsPerRoom: 1, staticDir: '', gamesDir: '', bundledGamesDir: '', joinTimeoutMs: 0, pingIntervalMs: 0,
  maxConnectionsPerIp: 0, trustProxy: false, publicUrl: '', captivePortal: false, consoleMode: false, consoleScreenAny: false, adminInsights: true, adminToken: '', idleRoomSeconds: 0, roomRestoreSeconds: 0, idleWarnSeconds: 60, hostIdleSeconds: 0,
  reconnectGraceSeconds: 60, profileStore: 'memory', dataDir: '', sqlitePath: '', sqliteBusyTimeoutMs: 5000, maxProfiles: 100, recentMatches: 10, brandName: 'Party Game', welcomeMessage: '', pluginsDir: '', bundledPluginsDir: '', pluginsEnabled: 'all',
};

describe('installed game routes', () => {
  let root: string;
  let srv: ReturnType<typeof startServer>;
  let base: string;
  let digest: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'pghttp-'));
    const installed = join(root, 'installed');
    mkdirSync(installed);
    writePackDir(fixturePack(), join(installed, 'fixture-game'));
    const games = await loadGames({ bundled: null, installed }, () => {});
    digest = games.games[0].digest;
    srv = startServer(cfg, { games });
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    srv.wss.close();
    srv.loop.stop();
    await new Promise<void>((r) => srv.http.close(() => r()));
    unregisterGames(['fixture-game']);
    unregisterMinigames(['fixture-game']);
    rmSync(root, { recursive: true, force: true });
  });

  it('lists installed games', async () => {
    const body = (await (await fetch(`${base}/games/index.json`)).json()) as { games: { id: string; digest: string }[] };
    expect(body.games.map((g) => g.id)).toEqual(['fixture-game']);
    expect(body.games[0].digest).toBe(digest);
  });

  it('serves a pack client as a module, cached forever only for its digest URL', async () => {
    const plain = await fetch(`${base}/games/fixture-game/client.mjs`);
    expect(plain.headers.get('content-type')).toContain('text/javascript');
    expect(plain.headers.get('cache-control')).toBe('no-cache');
    expect(await plain.text()).toBe(FIXTURE_CLIENT);
    const pinned = await fetch(`${base}/games/fixture-game/client.mjs?v=${digest}`);
    expect(pinned.headers.get('cache-control')).toContain('immutable');
  });

  it('404s unknown games and never serves other files', async () => {
    expect((await fetch(`${base}/games/nope/client.mjs`)).status).toBe(404);
    expect((await fetch(`${base}/games/fixture-game/server.mjs`)).status).not.toBe(200);
    expect((await fetch(`${base}/games/fixture-game/..%2Fgame.json`)).status).not.toBe(200);
  });
});
