import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerConfig } from '../config';
import { webManifest } from './manifest';
import { startServer } from './server';

describe('webManifest', () => {
  it('installs at the site root as a standalone app named after the brand', () => {
    const m = webManifest('Bonk Arena');
    expect(m).toMatchObject({ name: 'Bonk Arena', short_name: 'Bonk Arena', start_url: '/', scope: '/', display: 'standalone' });
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });
  it('shortens a long brand name for the home screen', () => {
    expect(webManifest('A very long brand name indeed').short_name.length).toBeLessThanOrEqual(12);
  });
});

describe('manifest route', () => {
  let dir: string;
  let srv: ReturnType<typeof startServer>;
  let base: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pgman-'));
    writeFileSync(join(dir, 'sw.js'), 'self.x=1');
    const cfg: ServerConfig = {
      profile: 'NORMAL', port: 0, host: '127.0.0.1', tickRate: 30, networkRate: 15, maxPlayersPerRoom: 2, maxRooms: 1,
      maxSpectatorsPerRoom: 1, staticDir: dir, gamesDir: '', bundledGamesDir: '', joinTimeoutMs: 0, pingIntervalMs: 0,
      maxConnectionsPerIp: 0, trustProxy: false, publicUrl: '', captivePortal: false, consoleMode: false, consoleScreenAny: false, adminInsights: true, adminToken: '', idleRoomSeconds: 0, roomRestoreSeconds: 0, idleWarnSeconds: 60, hostIdleSeconds: 0,
      reconnectGraceSeconds: 60, profileStore: 'memory', dataDir: '', sqlitePath: '', sqliteBusyTimeoutMs: 5000, maxProfiles: 100, recentMatches: 10, brandName: 'My Arcade', welcomeMessage: '', pluginsDir: '', bundledPluginsDir: '', pluginsEnabled: 'all',
    };
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    srv.wss.close();
    srv.loop.stop();
    await new Promise<void>((r) => srv.http.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the manifest with the configured brand and the right type', async () => {
    const res = await fetch(`${base}/manifest.webmanifest`);
    expect(res.headers.get('content-type')).toBe('application/manifest+json');
    expect(((await res.json()) as { name: string }).name).toBe('My Arcade');
  });
  it('serves the service worker from the root, never cached by the browser', async () => {
    const res = await fetch(`${base}/sw.js`);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});
