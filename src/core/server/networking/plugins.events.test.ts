import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PLUGIN_API_VERSION } from '../../shared';
import { loadConfig } from '../config';
import { loadPlugins } from '../plugins/features';
import { sha256 } from '../plugins/pack';
import { profileIdOf } from '../profiles';
import { startServer } from './server';

const code = `export default {
  start(host) {
    globalThis.__events = [];
    for (const e of ['profileChanged', 'resultRecorded', 'matchFinished']) host.events.on(e, (p) => globalThis.__events.push([e, p]));
  },
};`;

describe('plugin event bus', () => {
  const root = mkdtempSync(join(tmpdir(), 'pgplugev-'));
  let srv: ReturnType<typeof startServer>;
  let base: string;
  const seen = (): [string, any][] => (globalThis as any).__events;
  const key = 'a'.repeat(40);

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dir = join(root, 'plugins', 'ears');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.mjs'), code);
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ kind: 'plugin', id: 'ears', name: 'Ears', version: '1.0.0', apiVersion: PLUGIN_API_VERSION, author: 'a', license: 'MIT', description: 'd', files: { 'server.mjs': sha256(Buffer.from(code)) } }));
    const plugins = await loadPlugins({ bundled: null, installed: join(root, 'plugins') }, {}, () => {});
    const cfg = { ...loadConfig({}, () => {}), port: 0, host: '127.0.0.1', adminToken: 'tok', profileStore: 'memory' as const, staticDir: '', dataDir: root };
    srv = startServer(cfg, { plugins });
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
    for (let i = 0; i < 100 && !(globalThis as any).__events; i++) await new Promise((r) => setTimeout(r, 10));
  });

  afterAll(async () => {
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rings profileChanged for a player edit and an operator edit', async () => {
    const put = await fetch(`${base}/api/profile`, { method: 'PUT', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ name: 'Ann' }) });
    expect(put.status).toBe(200);
    const id = profileIdOf(key);
    expect(seen()).toContainEqual(['profileChanged', { profileId: id, reason: 'edit' }]);

    const patch = await fetch(`${base}/api/admin/profiles/${id}`, { method: 'PATCH', headers: { Authorization: 'Bearer tok' }, body: JSON.stringify({ name: 'Anna' }) });
    expect(patch.status).toBe(200);
    expect(seen()).toContainEqual(['profileChanged', { profileId: id, reason: 'admin' }]);
  });
});
