import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { INPUT_BUCKET_CAPACITY } from './limits';

const parsed = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../shared', async (orig) => {
  const real = await orig<typeof import('../../shared')>();
  return { ...real, parseClientMessage: (raw: string) => (parsed.calls++, real.parseClientMessage(raw)) };
});

import type { ServerConfig } from '../config';
import { metrics } from './metrics';
import { startServer } from './server';

const cfg = {
  profile: 'NORMAL', port: 0, host: '127.0.0.1', tickRate: 30, networkRate: 15, maxPlayersPerRoom: 2, maxRooms: 1, maxSpectatorsPerRoom: 1,
  staticDir: '', gamesDir: '', bundledGamesDir: '', joinTimeoutMs: 0, pingIntervalMs: 0, maxConnectionsPerIp: 0, trustProxy: false, publicUrl: '',
  captivePortal: false, consoleMode: false, consoleScreenAny: false, adminInsights: true, adminToken: '', idleRoomSeconds: 0, idleWarnSeconds: 60,
  hostIdleSeconds: 0, reconnectGraceSeconds: 60, profileStore: 'memory', dataDir: '', sqlitePath: '', sqliteBusyTimeoutMs: 5000, maxProfiles: 100,
  recentMatches: 10, brandName: 'Party Game', welcomeMessage: '', pluginsDir: '', bundledPluginsDir: '', pluginsEnabled: 'all',
} as ServerConfig;

describe('rate limiting happens before parsing', () => {
  let srv: ReturnType<typeof startServer>;
  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
  });
  afterAll(async () => {
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  it('does not parse the frames a flood sends beyond its budget', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${(srv.http.address() as AddressInfo).port}/ws`);
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise((r) => ws.once('close', r));
    const before = { parsed: parsed.calls, rejected: metrics.rejected };
    const frame = JSON.stringify({ t: 'INPUT', seq: 1, mx: 0, my: 0, a1: false, a2: false });
    const sent = 1000;
    for (let i = 0; i < sent; i++) ws.send(frame);
    await closed; // too many strikes: the server hangs up
    const rejected = metrics.rejected - before.rejected;
    expect(rejected).toBeGreaterThan(0);
    // only what fits the budget (plus what refills while the frames arrive) reaches the parser
    expect(parsed.calls - before.parsed).toBeLessThan(INPUT_BUCKET_CAPACITY + 20);
    expect(parsed.calls - before.parsed + rejected).toBeLessThanOrEqual(sent);
  });
});
