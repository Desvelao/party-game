import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginEventMap, PluginHost, PluginHttpRequest } from '../../../core/shared';
import plugin from './index';

const KEY = 'ab'.repeat(16);
const ID = createHash('sha256').update(KEY).digest('hex');

let dir = '';
afterEach(() => {
  plugin.stop?.();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function start() {
  dir = mkdtempSync(join(tmpdir(), 'pgprog-'));
  const listeners: ((p: PluginEventMap['resultRecorded']) => void)[] = [];
  const host = {
    dataDir: dir,
    events: { on: (_e: string, fn: (p: PluginEventMap['resultRecorded']) => void) => (listeners.push(fn), () => listeners.splice(0)) },
  } as unknown as PluginHost;
  plugin.start(host);
  return { emit: (p: PluginEventMap['resultRecorded']) => listeners.forEach((f) => f(p)), listeners };
}

const req = (over: Partial<PluginHttpRequest> = {}, admin = false): PluginHttpRequest => ({
  kind: 'api',
  method: 'GET',
  path: '/',
  query: {},
  body: {},
  ip: '10.0.0.1',
  admin: () => (admin ? { ok: true } : { ok: false, status: 401, error: 'no' }),
  requireAdmin: () => (admin ? null : { status: 401, body: { error: 'no' } }),
  ...over,
});

describe('progression plugin', () => {
  it('turns results into progress that the player reads with their key', async () => {
    const { emit } = start();
    emit({ profileId: ID, game: { id: 'tank', place: 1, points: 9 } });
    emit({ profileId: ID, match: { score: 9, won: true, place: 1, players: 3 } });
    const res = (await plugin.http!(req({ method: 'POST', body: { key: KEY } })))!;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ level: 2, xp: 15 + 50, wins: 1, streak: 1, bests: { tank: 1 } });
    expect((res.body as { achievements: object }).achievements).toHaveProperty('first-win');
  });

  it('an unknown player reads an empty book, and a bad key is refused', async () => {
    start();
    expect((await plugin.http!(req({ method: 'POST', body: { key: 'cd'.repeat(16) } })))!.body).toMatchObject({ level: 1, xp: 0 });
    expect((await plugin.http!(req({ method: 'POST', body: { key: 'nope' } })))!.status).toBe(401);
  });

  it('rate limits the player route', async () => {
    start();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await plugin.http!(req({ method: 'POST', body: { key: KEY } })))!.status;
    expect(last).toBe(429);
  });

  it('lists, shows and resets only for admins', async () => {
    const { emit } = start();
    emit({ profileId: ID, match: { score: 1, won: false, place: 2, players: 2 } });
    expect((await plugin.http!(req()))!.status).toBe(401);
    expect((await plugin.http!(req({ path: `/${ID}` })))!.status).toBe(401);
    expect((await plugin.http!(req({ method: 'POST', path: `/${ID}/reset` })))!.status).toBe(401);
    const list = (await plugin.http!(req({}, true)))!.body as { total: number; players: { id: string }[] };
    expect(list.total).toBe(1);
    expect(list.players[0]!.id).toBe(ID);
    expect((await plugin.http!(req({ path: `/${ID}` }, true)))!.status).toBe(200);
    expect((await plugin.http!(req({ method: 'POST', path: `/${ID}/reset` }, true)))!.status).toBe(200);
    expect((await plugin.http!(req({ path: `/${ID}` }, true)))!.status).toBe(404);
  });

  it('serves a data-free admin page and ignores other paths', async () => {
    start();
    const page = (await plugin.http!(req({ kind: 'page', path: '/' })))!;
    expect(page).toMatchObject({ status: 200, type: expect.stringContaining('text/html') });
    expect(String(page.body)).toContain('const API="/api/progression"');
    expect(await plugin.http!(req({ kind: 'page', path: '/x' }))).toBeUndefined();
    expect(await plugin.http!(req({ path: '/nothing' }))).toBeUndefined();
  });

  it('stops listening on stop', () => {
    const { listeners } = start();
    expect(listeners).toHaveLength(1);
    plugin.stop!();
    expect(listeners).toHaveLength(0);
  });
});
