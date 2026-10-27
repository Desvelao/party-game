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
  maxRooms: 2,
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
  async next<T extends ServerMessage['t']>(t: T, ms = 3000) {
    const deadline = Date.now() + ms;
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


type Priv = { hand: number[] };

/** the first GAME_STATE of the playing phase */
async function playing(c: Conn) {
  for (;;) {
    const s = await c.next('GAME_STATE', 8000);
    if (s.phase === 'playing') return s;
  }
}

describe('GAME_ACTION and GAME_PRIVATE over a real socket', () => {
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

  it('routes actions to the minigame, sends each player only their own hand', async () => {
    const host = await Conn.open(port);
    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Host', game: 'rumble-cards', variant: 'all' });
    const hw = await host.next('WELCOME');
    const b = await Conn.open(port);
    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Bea', code: hw.code });
    await b.next('WELCOME');
    const watcher = await Conn.open(port);
    watcher.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Watch', code: hw.code, spectate: true });
    await watcher.next('WELCOME');
    b.send({ t: 'READY', ready: true });
    await new Promise((r) => setTimeout(r, 50));
    host.send({ t: 'START_GAME' });
    await host.next('GAME_START');

    const hostHand = (await host.next('GAME_PRIVATE', 5000)).data as Priv;
    const beaHand = (await b.next('GAME_PRIVATE', 5000)).data as Priv;
    expect([3, 4]).toContain(hostHand.hand.length);
    expect([3, 4]).toContain(beaHand.hand.length);

    // a spectator never gets private state, and cannot act
    watcher.send({ t: 'GAME_ACTION', data: { a: 'end' } });
    expect((await watcher.next('ERROR')).code).toBe('BAD_STATE');
    expect(watcher.msgs.some((m) => m.t === 'GAME_PRIVATE')).toBe(false);

    // the player whose turn it is plays a card (actions only count once the countdown is over)
    const first = await playing(host);
    const turn = (first.state as unknown as { turn: string }).turn;
    const mover = turn === hw.id ? host : b;
    mover.send({ t: 'GAME_ACTION', data: { a: 'play', c: 0 } });
    for (;;) {
      const s = (await host.next('GAME_STATE', 3000)).state as unknown as { last: { p: string } | null };
      if (s.last) {
        expect(s.last.p).toBe(turn);
        break;
      }
    }
    // the hand changed, so the mover is sent the new one
    const next = (await mover.next('GAME_PRIVATE', 3000)).data as Priv;
    expect(next.hand.length).toBeLessThan(5);
  }, 20000);

  it('drops malformed actions without hurting the connection', async () => {
    const c = await Conn.open(port);
    c.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Solo' });
    await c.next('WELCOME');
    c.send({ t: 'GAME_ACTION', data: 'nope' });
    c.send({ t: 'GAME_ACTION', data: { s: 'x'.repeat(2000) } });
    c.send({ t: 'PING', ts: 1 });
    expect((await c.next('PONG')).ts).toBe(1);
  });
});
