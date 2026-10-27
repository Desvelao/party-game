import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../../shared';
import type { ServerConfig } from '../config';
import type { Client } from '../networking/Client';
import { RoomManager } from './RoomManager';
import { generateRoomCode } from './codes';

const cfg: ServerConfig = {
  profile: 'NORMAL',
  port: 0,
  host: '',
  tickRate: 60,
  networkRate: 20,
  maxPlayersPerRoom: 3,
  maxRooms: 4,
  maxSpectatorsPerRoom: 2,
  staticDir: '',
  gamesDir: '',
  bundledGamesDir: '',
  joinTimeoutMs: 10_000,
  pingIntervalMs: 30_000,
  maxConnectionsPerIp: 50,
  trustProxy: false,
  publicUrl: '',
  captivePortal: false, consoleMode: false, consoleScreenAny: false,
  adminInsights: true,
  adminToken: '',
  idleRoomSeconds: 600,
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

class FakeClient {
  msgs: ServerMessage[] = [];
  roomCode: string | null = null;
  constructor(readonly id: string) {}
  send(json: string) {
    this.msgs.push(JSON.parse(json));
  }
}

describe('RoomManager.update', () => {
  afterEach(() => vi.restoreAllMocks());

  it('tears down a room whose update throws while others keep updating', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mgr = new RoomManager(cfg);
    const bad = mgr.create()!;
    const good = mgr.create()!;
    const p = new FakeClient('p0');
    const q = new FakeClient('p1');
    bad.join(p as unknown as Client);
    good.join(q as unknown as Client);
    vi.spyOn(bad, 'update').mockImplementation(() => {
      throw new Error('boom');
    });
    const goodUpdate = vi.spyOn(good, 'update');

    mgr.update(1 / 60);
    mgr.update(1 / 60);

    expect(mgr.get(bad.code)).toBeUndefined();
    expect(mgr.get(good.code)).toBe(good);
    expect(goodUpdate).toHaveBeenCalledTimes(2);
    expect(p.msgs.some((m) => m.t === 'ERROR' && m.code === 'ROOM_CLOSED')).toBe(true);
    expect(p.roomCode).toBeNull();
    expect(q.roomCode).toBe(good.code);
  });

  it('closes lobby rooms idle past the timeout, notifying players; touch resets it', () => {
    const mgr = new RoomManager({ ...cfg, idleRoomSeconds: 10 });
    const idle = mgr.create()!;
    const active = mgr.create()!;
    const p = new FakeClient('p0');
    idle.join(p as unknown as Client);
    active.join(new FakeClient('p1') as unknown as Client);

    mgr.update(6);
    active.touch();
    mgr.update(6);

    expect(mgr.get(idle.code)).toBeUndefined();
    expect(mgr.get(active.code)).toBe(active);
    expect(p.msgs.some((m) => m.t === 'ERROR' && m.code === 'ROOM_CLOSED')).toBe(true);
    expect(p.roomCode).toBeNull();
  });

  it('never reaps when idleRoomSeconds is 0', () => {
    const mgr = new RoomManager({ ...cfg, idleRoomSeconds: 0 });
    const room = mgr.create()!;
    mgr.update(100000);
    expect(mgr.get(room.code)).toBe(room);
  });
});

describe('RoomManager limits and lifecycle', () => {
  it('create() returns null at maxRooms and frees a slot after releaseIfEmpty', () => {
    const mgr = new RoomManager({ ...cfg, maxRooms: 2 });
    const a = mgr.create()!;
    const b = mgr.create()!;
    expect(mgr.roomCount).toBe(2);
    expect(mgr.create()).toBeNull();
    expect(a.code).not.toBe(b.code);
    mgr.releaseIfEmpty(a); // never had a player
    expect(mgr.roomCount).toBe(1);
    expect(mgr.get(a.code)).toBeUndefined();
    expect(mgr.create()).not.toBeNull();
  });

  it('releaseIfEmpty keeps a room with a connected player, and closes it after they leave', () => {
    const mgr = new RoomManager(cfg);
    const room = mgr.create()!;
    const p = new FakeClient('p0');
    room.join(p as unknown as Client);
    mgr.releaseIfEmpty(room);
    expect(mgr.get(room.code)).toBe(room);
    room.leave('p0', undefined, true);
    mgr.releaseIfEmpty(room);
    expect(mgr.get(room.code)).toBeUndefined();
  });

  it('releaseIfEmpty keeps a lobby whose only player dropped until the grace period ends', () => {
    const mgr = new RoomManager(cfg);
    const room = mgr.create()!;
    room.join(new FakeClient('p0') as unknown as Client);
    room.leave('p0'); // a network drop, not a deliberate leave
    mgr.releaseIfEmpty(room);
    expect(mgr.get(room.code)).toBe(room);
    mgr.update(cfg.reconnectGraceSeconds + 1);
    expect(mgr.get(room.code)).toBeUndefined();
  });

  it('a spectator alone does not keep a room alive and is notified on close', () => {
    const mgr = new RoomManager(cfg);
    const room = mgr.create()!;
    const w = new FakeClient('w0');
    expect(room.joinSpectator(w as unknown as Client).ok).toBe(true);
    mgr.releaseIfEmpty(room);
    expect(mgr.get(room.code)).toBeUndefined();
    expect(w.msgs.some((m) => m.t === 'ERROR' && m.code === 'ROOM_CLOSED')).toBe(true);
  });

  it('allocates unique room codes', () => {
    const mgr = new RoomManager({ ...cfg, maxRooms: 40 });
    const codes = new Set<string>();
    for (let i = 0; i < 40; i++) codes.add(mgr.create()!.code);
    expect(codes.size).toBe(40);
  });
});

describe('RoomManager.list', () => {
  it('summarises rooms: open while joinable, playing when full or past the lobby', () => {
    const mgr = new RoomManager({ ...cfg, maxPlayersPerRoom: 1 });
    const a = mgr.create()!;
    const b = mgr.create()!;
    a.join(new FakeClient('p0') as unknown as Client);
    const byCode = Object.fromEntries(mgr.list().map((r) => [r.code, r]));
    expect(byCode[a.code]).toMatchObject({ status: 'playing', players: 1, maxPlayers: 1, phase: 'lobby' });
    expect(byCode[b.code]).toMatchObject({ status: 'open', players: 0 });
    b.phase = 'playing';
    expect(mgr.list().find((r) => r.code === b.code)!.status).toBe('playing');
  });
});

describe('generateRoomCode', () => {
  it('skips codes that exist and throws when none is free', () => {
    const taken = new Set<string>();
    const first = generateRoomCode(() => false, () => 0);
    taken.add(first);
    let n = 0;
    const next = generateRoomCode((c) => taken.has(c), () => (n++ < 4 ? 0 : 0.5));
    expect(next).not.toBe(first);
    expect(() => generateRoomCode(() => true)).toThrow();
  });
});

describe('RoomManager persistence', () => {
  it('snapshots only lobbies without a password and restores them under the same code', () => {
    const a = new RoomManager(cfg);
    const open = a.create(undefined, undefined, true)!;
    open.locked = true;
    a.create(undefined, 'secret', true);
    const saved = a.snapshots();
    expect(saved.map((s) => s.code)).toEqual([open.code]);
    const b = new RoomManager(cfg);
    expect(b.restore(saved)).toBe(1);
    const back = b.get(open.code)!;
    expect(back.isPublic).toBe(true);
    expect(back.locked).toBe(true);
    expect(b.list()[0]!.public).toBe(true);
    expect(b.restore(saved)).toBe(0); // already there
  });

  it('respects maxRooms when restoring', () => {
    const a = new RoomManager(cfg);
    a.create();
    a.create();
    const b = new RoomManager({ ...cfg, maxRooms: 1 });
    expect(b.restore(a.snapshots())).toBe(1);
  });
});
