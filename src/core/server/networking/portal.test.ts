import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { baseUrl, handlePortal, handleQr } from './portal';

let server: Server;
let port: number;
let publicUrl = '';
let portal = true;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (handleQr(path, publicUrl, req, res, false)) return;
    if (portal && handlePortal(path, publicUrl, req, res, false)) return;
    res.writeHead(200);
    res.end('game');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => void server.close());

// fetch cannot set Host, so these go through node:http
const get = (path: string, host?: string) =>
  new Promise<{ status: number; location?: string; body: string; type?: string }>((resolve, reject) => {
    import('node:http').then(({ request }) => {
      const r = request({ host: '127.0.0.1', port, path, headers: host ? { host } : {} }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, location: res.headers.location, body, type: res.headers['content-type'] }));
      });
      r.on('error', reject);
      r.end();
    });
  });

describe('baseUrl', () => {
  it('prefers the configured address, then a sane Host', () => {
    expect(baseUrl('http://partygame.local', 'x:1', false)).toBe('http://partygame.local');
    expect(baseUrl('', 'partygame.local', false)).toBe('http://partygame.local');
    expect(baseUrl('', 'a b', false)).toBeNull();
    expect(baseUrl('', undefined, false)).toBeNull();
  });
});

describe('GET /qr/<ROOM>', () => {
  it('serves an svg of the join link', async () => {
    publicUrl = '';
    const r = await get('/qr/abcd', 'partygame.local');
    expect(r.status).toBe(200);
    expect(r.type).toBe('image/svg+xml');
    expect(r.body.startsWith('<svg')).toBe(true);
  });
  it('rejects a malformed room code', async () => {
    expect((await get('/qr/ab-cd', 'partygame.local')).status).not.toBe(200);
  });
  it('rejects a hostile Host header', async () => {
    expect((await get('/qr/ABCD', 'a"><script>')).status).toBe(400);
  });
});

describe('captive portal', () => {
  it('redirects probes to the public address', async () => {
    publicUrl = 'http://partygame.local';
    for (const p of ['/generate_204', '/hotspot-detect.html', '/connecttest.txt']) {
      const r = await get(p, '192.168.4.1');
      expect(r.status).toBe(302);
      expect(r.location).toBe('http://partygame.local/');
    }
  });
  it('sends unknown hostnames to the game, without looping', async () => {
    publicUrl = '';
    const r = await get('/anything', 'example.com');
    expect(r.status).toBe(302);
    expect(r.location).toBe(`http://127.0.0.1:${port}/`);
  });
  it('leaves the game itself alone', async () => {
    publicUrl = 'http://partygame.local';
    expect((await get('/', 'partygame.local')).body).toBe('game');
    expect((await get('/', '192.168.4.1')).body).toBe('game');
  });
  it('does nothing when off', async () => {
    portal = false;
    expect((await get('/generate_204', 'example.com')).body).toBe('game');
    portal = true;
  });
});
