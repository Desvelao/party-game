import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import { startServer } from '../networking/server';

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
  trustProxy: true, publicUrl: '', captivePortal: false, consoleMode: false, consoleScreenAny: false, adminInsights: true, // lets the test pick each client's address with X-Forwarded-For
  adminToken: 'tok',
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
  closeCode: Promise<number>;
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closeCode = new Promise((r) => ws.on('close', (code) => r(code)));
  }
  static open(port: number, ip: string): Promise<Conn> {
    const c = new Conn(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'x-forwarded-for': ip } }));
    return new Promise((res, rej) => {
      c.ws.once('open', () => res(c));
      c.ws.once('error', rej);
    });
  }
  send(o: unknown) {
    this.ws.send(JSON.stringify(o));
  }
  async next<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    const deadline = Date.now() + 2000;
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
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
}

describe('admin moderation', () => {
  let srv: ReturnType<typeof startServer>;
  let port: number;
  const conns: Conn[] = [];
  const open = async (ip: string) => {
    const c = await Conn.open(port, ip);
    conns.push(c);
    return c;
  };
  const api = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
    fetch(`http://127.0.0.1:${port}/api/admin${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${init.token ?? 'tok'}`,
        // the admin calls come from a fixed address so they never match the players' addresses
        'x-forwarded-for': '10.9.9.9',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    srv = startServer(cfg);
    await new Promise<void>((r) => (srv.http.listening ? r() : srv.http.once('listening', () => r())));
    port = (srv.http.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const c of conns) c.ws.terminate();
    srv.loop.stop();
    srv.wss.close();
    await new Promise<void>((r) => srv.http.close(() => r()));
    vi.restoreAllMocks();
  });

  it('lists, broadcasts, locks, kicks+bans and closes', async () => {
    const host = await open('10.0.0.1');
    host.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Host' });
    const welcome = await host.next('WELCOME');
    const code = welcome.code;
    const guest = await open('10.0.0.2');
    guest.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Guest', code });
    const gw = await guest.next('WELCOME');

    // list + detail
    const rooms = (await (await api('/rooms')).json()) as { rooms: { code: string; players: number }[] };
    expect(rooms.rooms).toEqual([expect.objectContaining({ code, players: 2 })]);
    const detail = (await (await api(`/rooms/${code}`)).json()) as { members: { id: string; ip: string; host: boolean }[] };
    expect(detail.members.map((m) => m.ip).sort()).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(detail.members.find((m) => m.id === welcome.id)?.host).toBe(true);
    const clients = (await (await api('/clients')).json()) as { clients: unknown[] };
    expect(clients.clients).toHaveLength(2);

    // broadcast reaches everyone
    expect((await api(`/rooms/${code}/broadcast`, { body: { message: 'Pizza is here' } })).status).toBe(200);
    expect((await host.next('NOTICE')).message).toBe('Pizza is here');
    expect((await guest.next('NOTICE')).message).toBe('Pizza is here');
    expect((await api('/broadcast', { body: { message: '' } })).status).toBe(400);

    // lock refuses newcomers
    await api(`/rooms/${code}/lock`, { body: { locked: true } });
    const late = await open('10.0.0.3');
    late.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Late', code });
    expect((await late.next('ERROR')).code).toBe('ROOM_LOCKED');
    await api(`/rooms/${code}/lock`, { body: { locked: false } });

    // kick + ban removes the guest, and the address cannot connect again
    const res = await api(`/rooms/${code}/kick`, { body: { id: gw.id, ban: true, reason: 'rude' } });
    expect(await res.json()).toEqual({ ok: true, banned: true });
    expect((await guest.next('ERROR')).code).toBe('BANNED');
    expect(await guest.closeCode).toBe(1008);
    const again = await open('10.0.0.2');
    expect((await again.next('ERROR')).code).toBe('BANNED');
    expect(await again.closeCode).toBe(1008);

    const bans = (await (await api('/bans')).json()) as { bans: { kind: string; value: string; reason?: string }[] };
    expect(bans.bans).toEqual([expect.objectContaining({ kind: 'ip', value: '10.0.0.2', reason: 'rude' })]);

    // lifting the ban lets them back
    expect((await api('/bans?ip=10.0.0.2', { method: 'DELETE' })).status).toBe(200);
    expect((await api('/bans?ip=10.0.0.2', { method: 'DELETE' })).status).toBe(404);
    const back = await open('10.0.0.2');
    back.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Guest', code });
    await back.next('WELCOME');

    // close notifies the room
    expect((await api(`/rooms/${code}/close`, { body: {} })).status).toBe(200);
    expect((await host.next('ERROR', (m) => m.code === 'ROOM_CLOSED')).code).toBe('ROOM_CLOSED');
    expect(srv.rooms.roomCount).toBe(0);
    expect((await api(`/rooms/${code}`)).status).toBe(404);

    // everything above is in the audit log
    const audit = (await (await api('/audit')).json()) as { entries: { action: string }[] };
    expect(audit.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['room.broadcast', 'room.lock', 'room.kick+ban', 'unban', 'room.close']),
    );
  });

  it('lists player reports for the operator and exports audit and reports as CSV', async () => {
    const a = await open('10.3.0.1');
    a.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Reporter' });
    const wa = await a.next('WELCOME');
    const b = await open('10.3.0.2');
    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Rude', code: wa.code });
    const wb = await b.next('WELCOME');
    a.send({ t: 'REPORT', id: wb.id });
    let reports: { reports: { reporter: string; target: string; room: string }[] } = { reports: [] };
    for (let i = 0; i < 40 && reports.reports.length === 0; i++) {
      reports = (await (await api('/reports')).json()) as typeof reports;
      if (reports.reports.length === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(reports.reports).toMatchObject([{ reporter: 'Reporter', target: 'Rude', room: wa.code }]);

    const csv = await api('/reports?format=csv');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect((await csv.text()).split('\r\n')[0]).toBe('time,room,reporter,target,targetProfileId');
    const auditCsv = await api('/audit?format=csv');
    expect((await auditCsv.text()).split('\r\n')[0]).toBe('time,action,target,ip,detail');

    expect(await (await api('/reports', { method: 'DELETE' })).json()).toEqual({ cleared: 1 });
    expect(((await (await api('/reports')).json()) as { reports: unknown[] }).reports).toEqual([]);
    await api(`/rooms/${wa.code}/close`, { body: {} });
  });

  it('reports banned from the outcome, not the request flags', async () => {
    const a = await open('10.2.0.1');
    a.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A' });
    const wa = await a.next('WELCOME');
    const b = await open('10.2.0.2');
    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'B', code: wa.code });
    const wb = await b.next('WELCOME');
    const add = vi.spyOn(srv.bans, 'add').mockReturnValue(null);
    const res = await api(`/rooms/${wa.code}/kick`, { body: { id: wb.id, ban: true } });
    add.mockRestore();
    expect(await res.json()).toEqual({ ok: true, banned: false, banFailed: true });
    expect((await b.next('ERROR')).code).toBe('KICKED');
    const audit = (await (await api('/audit')).json()) as { entries: { action: string; target: string }[] };
    expect(audit.entries.some((e) => e.action === 'room.kick+ban' && e.target === `${wa.code}/${wb.id}`)).toBe(false);
    expect(audit.entries.some((e) => e.action === 'room.kick' && e.target === `${wa.code}/${wb.id}`)).toBe(true);
    await api(`/rooms/${wa.code}/close`, { body: {} });
  });

  it('validates input and refuses to ban the caller', async () => {
    expect((await api('/bans', { body: {} })).status).toBe(400);
    expect((await api('/bans', { body: { ip: '1.1.1.1', profileId: 'x' } })).status).toBe(400);
    expect((await api('/bans', { body: { ip: '10.9.9.9' } })).status).toBe(400);
    expect((await api('/rooms/NOPE')).status).toBe(404);
    expect((await api('/rooms/%20')).status).toBe(404);
    const ok = await api('/bans', { body: { ip: '1.1.1.1', minutes: 5 } });
    expect(ok.status).toBe(200);
    expect(srv.bans.isBanned('ip', '1.1.1.1')).toBe(true);
    srv.bans.remove('ip', '1.1.1.1');
  });

  it('promotes a new host when the admin removes the host', async () => {
    const a = await open('10.1.0.1');
    a.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A' });
    const wa = await a.next('WELCOME');
    const b = await open('10.1.0.2');
    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'B', code: wa.code });
    const wb = await b.next('WELCOME');
    expect((await api(`/rooms/${wa.code}/kick`, { body: { id: wa.id } })).status).toBe(200);
    expect((await a.next('ERROR')).code).toBe('KICKED');
    const upd = await b.next('ROOM_UPDATE', (m) => m.players.length === 1);
    expect(upd.hostId).toBe(wb.id);
    // removing the last player frees the room
    await api(`/rooms/${wa.code}/kick`, { body: { id: wb.id } });
    expect(srv.rooms.get(wa.code)).toBeUndefined();
  });
  it('hands the host role over and lists room age and idle time', async () => {
    const a = await open('10.1.1.1');
    a.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A' });
    const wa = await a.next('WELCOME');
    const b = await open('10.1.1.2');
    b.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'B', code: wa.code });
    const wb = await b.next('WELCOME');
    expect((await api(`/rooms/${wa.code}/host`, { body: { id: 'nobody' } })).status).toBe(404);
    expect((await api(`/rooms/${wa.code}/host`, { body: { id: wb.id } })).status).toBe(200);
    const notice = await a.next('NOTICE', (m) => m.code === 'HOST_CHANGED');
    expect(notice.id).toBe(wb.id);
    const listed = ((await (await api('/rooms')).json()) as any).rooms.find((r: any) => r.code === wa.code);
    expect(listed).toMatchObject({ idleSeconds: expect.any(Number), ageSeconds: expect.any(Number) });
    expect(((await (await api('/rooms?idleOver=9999')).json()) as any).rooms).toEqual([]);
  });
});
