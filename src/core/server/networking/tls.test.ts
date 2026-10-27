import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig, type ServerConfig } from '../config';
import { parseConfigText } from '../configFile';
import { startServer } from './server';
import { tlsFiles } from './tls';

let openssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  openssl = false;
}

describe('tls settings', () => {
  it('are off by default and read from the environment and the server section of the file', () => {
    expect(loadConfig().tlsCert).toBe('');
    expect(loadConfig().tlsKey).toBe('');
    process.env.TLS_CERT = '/c.pem';
    process.env.TLS_KEY = '/k.pem';
    try {
      expect(loadConfig()).toMatchObject({ tlsCert: '/c.pem', tlsKey: '/k.pem' });
    } finally {
      delete process.env.TLS_CERT;
      delete process.env.TLS_KEY;
    }
    const fromFile = loadConfig(parseConfigText('server:\n  tlsCert: /a.pem\n  tlsKey: /b.pem\n'));
    expect(fromFile).toMatchObject({ tlsCert: '/a.pem', tlsKey: '/b.pem' });
  });

  it('plain HTTP when neither is set, an error when only one is or a file is missing', () => {
    expect(tlsFiles({ tlsCert: '', tlsKey: '' })).toBeNull();
    expect(tlsFiles({})).toBeNull();
    expect(() => tlsFiles({ tlsCert: '/c.pem', tlsKey: '' })).toThrow(/needs both/);
    expect(() => tlsFiles({ tlsCert: '', tlsKey: '/k.pem' })).toThrow(/needs both/);
    expect(() => tlsFiles({ tlsCert: '/nope/c.pem', tlsKey: '/nope/k.pem' })).toThrow(/cannot read the TLS certificate file \/nope\/c\.pem/);
  });
});

describe.skipIf(!openssl)('serving over TLS', () => {
  let dir: string;
  let srv: ReturnType<typeof startServer>;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pgtls-'));
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
    const cfg: ServerConfig = {
      profile: 'NORMAL', port: 0, host: '127.0.0.1', tickRate: 30, networkRate: 15, maxPlayersPerRoom: 2, maxRooms: 1,
      maxSpectatorsPerRoom: 1, staticDir: dir, gamesDir: '', bundledGamesDir: '', joinTimeoutMs: 0, pingIntervalMs: 0,
      maxConnectionsPerIp: 0, trustProxy: false, publicUrl: '', captivePortal: false, consoleMode: false, consoleScreenAny: false, adminInsights: true, adminToken: '', idleRoomSeconds: 0, roomRestoreSeconds: 0, idleWarnSeconds: 60, hostIdleSeconds: 0,
      reconnectGraceSeconds: 60, profileStore: 'memory', dataDir: '', sqlitePath: '', sqliteBusyTimeoutMs: 5000, maxProfiles: 100, recentMatches: 10, brandName: 'Party Game', welcomeMessage: '', pluginsDir: '', bundledPluginsDir: '', pluginsEnabled: 'all',
      tlsCert: cert, tlsKey: key,
    };
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
  });
  afterAll(async () => {
    srv.wss.close();
    srv.loop.stop();
    await new Promise<void>((r) => srv.http.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves /stats and the page over https', async () => {
    const body = await new Promise<string>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/stats', rejectUnauthorized: false }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(`${res.statusCode} ${data}`));
      }).on('error', reject);
    });
    expect(body).toMatch(/^200 \{/);
  });

  it('rejects an untrusted certificate unless told to accept it, and speaks wss', async () => {
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`);
      ws.on('open', () => resolve(true));
      ws.on('error', reject);
    })).rejects.toThrow(/self[- ]signed|certificate/i);
    const welcome = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false });
      ws.on('open', () => ws.send(JSON.stringify({ t: 'PING', ts: 1 })));
      ws.on('message', (m) => {
        resolve(String(m));
        ws.close();
      });
      ws.on('error', reject);
    });
    expect(JSON.parse(welcome).t).toMatch(/WELCOME|PONG/);
  });
});
