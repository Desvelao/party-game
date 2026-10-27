import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from './http';

describe('static handler client routes', () => {
  let srv: Server;
  let base: string;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pg-static-'));
    writeFileSync(path.join(dir, 'index.html'), '<title>app</title>');
    const handler = createStaticHandler(dir);
    srv = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));

  it('serves the app shell for /, /profile and /room/<ID>', async () => {
    for (const p of ['/', '/profile', '/room/ABCD', '/room/ABCD?spectate=1']) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(200);
      expect(await res.text()).toContain('<title>app</title>');
    }
  });

  it('serves the app shell for the console pages /tv and /console', async () => {
    for (const p of ['/tv', '/tv/', '/console']) expect((await fetch(base + p)).status, p).toBe(200);
    expect((await fetch(base + '/tvx')).status).toBe(404);
  });

  it('serves the app shell for the pages plugins draw, and only those', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pg-static-'));
    writeFileSync(path.join(dir, 'index.html'), '<title>app</title>');
    const handler = createStaticHandler(dir, () => ['/leaderboard']);
    const s = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      expect((await fetch(url + '/leaderboard')).status).toBe(200);
      expect((await fetch(url + '/leaderboard/')).status).toBe(200);
      expect((await fetch(url + '/other')).status).toBe(404);
      expect((await fetch(base + '/leaderboard')).status).toBe(404); // no plugin draws it: the plain handler 404s
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it('still 404s unknown paths', async () => {
    expect((await fetch(base + '/nope')).status).toBe(404);
    expect((await fetch(base + '/room/a/b')).status).toBe(404);
  });
});
