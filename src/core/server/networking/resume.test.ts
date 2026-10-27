import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from './server';

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
  adminToken: '',
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

class Conn {
  msgs: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  static open(port: number): Promise<Conn> {
    const c = new Conn(new WebSocket(`ws://127.0.0.1:${port}/ws`));
    return new Promise((res, rej) => {
      c.ws.once('open', () => res(c));
      c.ws.once('error', rej);
    });
  }
  send(o: unknown) {
    this.ws.send(JSON.stringify(o));
  }
  async next<T extends ServerMessage['t']>(t: T) {
    const deadline = Date.now() + 3000;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t);
      if (i >= 0) return this.msgs.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${t}`);
      await new Promise<void>((r) => {
        const to = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(to);
          r();
        });
      });
    }
  }
  async closeAndWait() {
    await new Promise<void>((r) => {
      this.ws.once('close', () => r());
      this.ws.close();
    });
  }
}

describe('resume over a real socket', () => {
  let srv: ReturnType<typeof startServer>;
  let port = 0;
  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    if (!srv.http.listening) await new Promise<void>((r) => srv.http.once('listening', () => r()));
    port = (srv.http.address() as AddressInfo).port;
  });
  afterAll(async () => {
    srv.loop.stop();
    srv.wss.clients.forEach((c) => c.terminate());
    await new Promise<void>((r) => srv.http.close(() => r()));
  });

  it('a dropped player re-attaches with the token and keeps their id; a wrong token does not', async () => {
    const host = await Conn.open(port);
    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Host' });
    const hw = await host.next('WELCOME');
    expect(hw.resume).toMatch(/^[0-9a-f]{32}$/);

    const b = await Conn.open(port);
    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Bea', code: hw.code });
    const bw = await b.next('WELCOME');
    expect(bw.id).not.toBe(hw.id);
    expect(bw.resume).toBeTruthy();
    expect(bw.resume).not.toBe(hw.resume);
    b.send({ t: 'READY', ready: true });
    await new Promise((r) => setTimeout(r, 50));
    host.send({ t: 'START_GAME' });
    await host.next('GAME_START');

    await b.closeAndWait();

    // wrong token: must not get Bea's identity
    const evil = await Conn.open(port);
    evil.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Evil', code: hw.code, resume: 'a'.repeat(32) });
    const first = await Promise.race([
      evil.next('WELCOME').then((w) => ({ w })),
      evil.next('ERROR').then((e) => ({ e })),
    ]);
    if ('w' in first) {
      expect(first.w.id).not.toBe(bw.id);
      expect(first.w.spectator).toBe(true);
    } else {
      expect(first.e.code).toBeTruthy();
    }

    // right token: same identity back
    const b2 = await Conn.open(port);
    b2.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'whoever', code: hw.code, resume: bw.resume });
    const w2 = await b2.next('WELCOME');
    expect(w2.id).toBe(bw.id);
    expect(w2.spectator).toBe(false);
    const upd = await b2.next('ROOM_UPDATE');
    expect(upd.players.find((p) => p.id === bw.id)?.connected).toBe(true);
    // the token must never be broadcast
    expect(JSON.stringify(upd)).not.toContain(bw.resume as string);
  });
});
