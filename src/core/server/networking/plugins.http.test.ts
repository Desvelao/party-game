import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PLUGIN_API_VERSION, RESERVED_PLUGIN_IDS, validatePluginManifest } from '../../shared';
import { loadConfig } from '../config';
import { loadPlugins } from '../plugins/features';
import { sha256 } from '../plugins/pack';
import { startServer } from './server';

const code = `export default {
  start() {},
  http(req) {
    if (req.kind === 'page') return { status: 200, type: 'text/html; charset=utf-8', body: '<p>hi ' + req.path + '</p>' };
    if (req.path === '/open') return { status: 200, body: { public: true } };
    const denied = req.requireAdmin();
    if (denied) return denied;
    if (req.path === '/boom') throw new Error('nope');
    if (req.path === '/echo') return { status: 201, body: { method: req.method, query: req.query, body: req.body } };
    return undefined;
  },
};`;

describe('plugin endpoints', () => {
  const root = mkdtempSync(join(tmpdir(), 'pgplughttp-'));
  let srv: ReturnType<typeof startServer>;
  let base: string;
  const get = (path: string, init: RequestInit = {}) => fetch(base + path, init);
  const admin = { Authorization: 'Bearer tok' };

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = join(root, 'plugins', 'echo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.mjs'), code);
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ kind: 'plugin', id: 'echo', name: 'Echo', version: '1.0.0', apiVersion: PLUGIN_API_VERSION, author: 'a', license: 'MIT', description: 'd', files: { 'server.mjs': sha256(Buffer.from(code)) } }));
    const plugins = await loadPlugins({ bundled: null, installed: join(root, 'plugins') }, {}, () => {});
    const cfg = { ...loadConfig({}, () => {}), port: 0, host: '127.0.0.1', adminToken: 'tok', profileStore: 'memory' as const, staticDir: '', dataDir: root };
    srv = startServer(cfg, { plugins });
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
    for (let i = 0; i < 100 && !plugins.hasHttp('echo'); i++) await new Promise((r) => setTimeout(r, 10));
  });

  afterAll(async () => {
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('serves pages under /plugins/<id>/ and the API under /api/<id>/', async () => {
    const page = await get('/plugins/echo/some/page');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).toBe('<p>hi /some/page</p>');
    expect((await get('/plugins/echo/')).status).toBe(200);
    expect(await (await get('/api/echo/open')).json()).toEqual({ public: true });
  });

  it('leaves the admin check to the plugin and counts wrong tokens', async () => {
    expect((await get('/api/echo/echo')).status).toBe(401);
    expect((await get('/api/echo/echo', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    const ok = await get('/api/echo/echo?x=1&y=two', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ method: 'POST', query: { x: '1', y: 'two' }, body: { a: 1 } });
  });

  it('gives the plugin null for a body that is not a small JSON object', async () => {
    const bad = await get('/api/echo/echo', { method: 'POST', headers: admin, body: '[1,2]' });
    expect((await bad.json()).body).toBeNull();
    const big = await get('/api/echo/echo', { method: 'POST', headers: admin, body: JSON.stringify({ x: 'y'.repeat(20_000) }) });
    expect((await big.json()).body).toBeNull();
  });

  it('answers 404 for what the plugin does not handle and for unknown plugins, and 500 when it throws', async () => {
    expect((await get('/api/echo/missing', { headers: admin })).status).toBe(404);
    expect((await get('/api/nobody/state')).status).not.toBe(200);
    expect((await get('/plugins/nobody/')).status).toBe(404);
    expect((await get('/api/echo/boom', { headers: admin })).status).toBe(500);
  });

  it('keeps client.mjs for the plugin loader, not for the plugin page handler', async () => {
    expect((await get('/plugins/echo/client.mjs')).status).toBe(404); // the page handler answers 200 for any other path
  });

  it('does not touch the core API', async () => {
    expect((await get('/api/catalog')).status).toBe(200);
    expect((await get('/api/admin/config')).status).toBe(401);
  });

  it('lists the plugin with its interface flags', async () => {
    const idx = (await (await get('/plugins/index.json')).json()) as { plugins: { id: string; http: boolean; client: boolean }[] };
    expect(idx.plugins).toEqual([expect.objectContaining({ id: 'echo', http: true, client: false })]);
  });
});

describe('reserved plugin ids', () => {
  it('reserves every core /api/<namespace>', () => {
    for (const ns of ['admin', 'catalog', 'profile']) expect(RESERVED_PLUGIN_IDS).toContain(ns);
  });

  it('rejects ids that would shadow a core route', () => {
    const base = { kind: 'plugin', version: '1.0.0', apiVersion: PLUGIN_API_VERSION, author: 'a', license: 'MIT', description: 'd', files: { 'server.mjs': 'a'.repeat(64) } };
    for (const id of ['admin', 'profile', 'stats', 'catalog', 'games', 'plugins']) {
      const r = validatePluginManifest({ ...base, id, name: id });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.errors.join()).toContain('reserved');
    }
    expect(validatePluginManifest({ ...base, id: 'bots', name: 'Bots' }).ok).toBe(true);
    expect(validatePluginManifest({ ...base, id: 'leaderboard', name: 'Leaderboard' }).ok).toBe(true); // a plugin now serves it
  });
});
