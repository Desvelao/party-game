import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION, type PluginHost, type PluginRoom, type ServerMessage } from '../../../core/shared';
import { loadConfig } from '../../../core/server/config';
import type { RoomClient } from '../../../core/server/networking/Client';
import { Room } from '../../../core/server/rooms/Room';
import { RoomManager } from '../../../core/server/rooms/RoomManager';
import type { PluginHttpRequest } from '../../../core/shared';
import plugin from './index';

class Fake implements RoomClient {
  msgs: ServerMessage[] = [];
  profileId = null;
  looks = {};
  preferredColor = null;
  roomCode: string | null = null;
  ip = '';
  constructor(public id: string, public name = id) {}
  send(json: string) { this.msgs.push(JSON.parse(json)); }
  close() {}
}

function setup(config: Record<string, string | number | boolean> = {}) {
  const cfg = { ...loadConfig({}, () => {}), maxPlayersPerRoom: 4, reconnectGraceSeconds: 60 };
  const manager = new RoomManager(cfg);
  const host: PluginHost = {
    coreVersion: '0.1.0',
    dataDir: '/tmp/pg-bots-test',
    profile: 'NORMAL',
    tickRate: 60,
    config: { allowFill: true, defaultLevel: 'normal', mode: 'external', token: 'tok', maxBots: 0, decisionHz: 0, mixed: 'never', playlistJoin: 'any', idleLeaveSeconds: 120, namePrefix: 'Bot', api: true, dashboard: true, liveConfig: true, audit: false, metrics: false, reports: false, reportsDir: '', ...config },
    rooms: { list: () => manager.all(), get: (c) => manager.get(c), on: (e, fn) => manager.on(e, fn as (r: Room) => void) },
    virtualRooms: { list: () => manager.all(), get: (c) => manager.get(c), on: (e, fn) => manager.on(e, fn as (r: Room) => void) },
    stats: () => ({ rooms: 0, maxRooms: 0, clients: 0, loop: { ticks: 0, overruns: 0, avgStepMs: 0, maxStepMs: 0, avgLagMs: 0, maxLagMs: 0 }, net: { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, rejected: 0, droppedFrames: 0 } }),
    matches: { playedSinceStart: () => 0, recent: () => [] },
    games: { ais: () => [], playableIds: () => null },
    characters: { models: () => [] },
    profiles: { list: async () => null },
    events: { on: () => () => {} },
    plugin: () => undefined,
    every: () => {},
    log: () => {},
  };
  return { manager, host };
}

const stateOf = (room: PluginRoom) => room.getExt('bots') as { fill: boolean; level: string; seats: { id: string; level: string }[] };

async function roomWith(config?: Record<string, string | number | boolean>) {
  const { manager, host } = setup(config);
  await plugin.start(host);
  const room = manager.create({ ...DEFAULT_SELECTION, game: 'crazy-logs' })!;
  const human = new Fake('p0');
  room.join(human);
  return { manager, room, human };
}

describe('bots plugin (server half)', () => {
  it('does nothing unless bots are allowed', async () => {
    const { room } = await roomWith({ allowFill: false });
    expect(room.getExt('bots')).toBeUndefined();
    expect(plugin.roomSummary!(room)).toBeUndefined();
  });

  it('keeps the settings in the room, only for the host and only in the lobby', async () => {
    const { room } = await roomWith();
    room.join(new Fake('p1'));
    expect(stateOf(room)).toEqual({ fill: false, level: 'normal', seats: [] });
    plugin.onAction!(room, 'p1', { a: 'fill', on: true });
    expect(stateOf(room).fill).toBe(false);
    plugin.onAction!(room, 'p0', { a: 'fill', on: true });
    plugin.onAction!(room, 'p0', { a: 'level', level: 'hard' });
    plugin.onAction!(room, 'p0', { a: 'level', level: 'godlike' });
    plugin.onAction!(room, 'p0', { a: 'fill', on: 'yes' });
    expect(stateOf(room)).toMatchObject({ fill: true, level: 'hard' });
    expect(plugin.roomSummary!(room)).toMatchObject({ fill: true, level: 'hard', mode: 'external' });
  });

  it('reserves a seat per added bot and releases it on remove', async () => {
    const { room } = await roomWith();
    plugin.onAction!(room, 'p0', { a: 'add', level: 'expert' });
    plugin.onAction!(room, 'p0', { a: 'add' });
    expect(stateOf(room).seats.map((s) => s.level)).toEqual(['expert', 'normal']);
    expect(room.reservedSeats('bots')).toHaveLength(2);
    plugin.onAction!(room, 'p0', { a: 'remove', id: stateOf(room).seats[0].id });
    expect(stateOf(room).seats).toHaveLength(1);
    expect(room.reservedSeats('bots')).toHaveLength(1);
  });

  it('seats a bot only with the token, a good level and a seat or the fill setting', async () => {
    const { room } = await roomWith();
    const ask = (token: string | undefined, data: Record<string, unknown>) => plugin.virtualPlayers!.authorizeJoin(room, { token, data });
    expect(ask(undefined, { level: 'easy' })).toBe('Bot token rejected');
    expect(ask('wrong', { level: 'easy' })).toBe('Bot token rejected');
    expect(ask('tok', { level: 'easy' })).toBe('This room does not take fill bots');
    plugin.onAction!(room, 'p0', { a: 'fill', on: true });
    expect(ask('tok', { level: 'nope' })).toBe('Unknown bot level');
    expect(ask('tok', { level: 'easy' })).toMatchObject({ plugin: 'bots', yields: true, ext: { level: 'easy', added: false } });
    expect(ask('tok', { level: 'easy', seat: 'zzz' })).toBe('No such bot seat');
    plugin.onAction!(room, 'p0', { a: 'add', level: 'hard' });
    const seat = stateOf(room).seats[0].id;
    expect(ask('tok', { level: 'hard', seat })).toMatchObject({ seat, yields: false, ext: { added: true } });
  });

  it('turning fill off sends away the fill bots but not the added ones; a seat taken leaves the pending list', async () => {
    const { room, manager } = await roomWith();
    plugin.onAction!(room, 'p0', { a: 'fill', on: true });
    plugin.onAction!(room, 'p0', { a: 'add', level: 'hard' });
    const seat = stateOf(room).seats[0].id;
    expect(room.joinVirtual(new Fake('fill'), { plugin: 'bots', yields: true, ext: { level: 'easy', added: false } }).ok).toBe(true);
    expect(room.joinVirtual(new Fake('added'), { plugin: 'bots', seat, ext: { level: 'hard', added: true } }).ok).toBe(true);
    manager.update(1 / 60); // plugins hear about a change once per tick
    expect(stateOf(room).seats).toEqual([]);
    plugin.onAction!(room, 'p0', { a: 'fill', on: false });
    expect(room.memberList().map((m) => m.id)).toEqual(['p0', 'added']);
    plugin.onAction!(room, 'p0', { a: 'remove', id: 'added' });
    expect(room.memberList().map((m) => m.id)).toEqual(['p0']);
  });
});

describe('bots plugin (management)', () => {
  const request = (over: Partial<Omit<PluginHttpRequest, 'admin'>> & { admin?: boolean } = {}): PluginHttpRequest => {
    const { admin = true, ...rest } = over;
    return {
      kind: 'api',
      method: 'GET',
      path: '/state',
      query: {},
      body: {},
      ip: '127.0.0.1',
      admin: () => (admin ? { ok: true } : { ok: false, status: 401, error: 'no' }),
      requireAdmin: () => (admin ? null : { status: 401, body: { error: 'no' } }),
      ...rest,
    };
  };
  const embedded = async (config: Record<string, string | number | boolean> = {}) => {
    const { manager, host } = setup({ mode: 'embedded', ...config });
    await plugin.start(host);
    return manager;
  };

  it('serves nothing while the bots are external', async () => {
    const { host } = setup();
    await plugin.start(host);
    expect(await plugin.http!(request())).toBeUndefined();
    expect(await plugin.http!(request({ kind: 'page', path: '/' }))).toBeUndefined();
    plugin.stop!();
  });

  it('embedded: the dashboard page is public shell, the API is admin only and shows the rooms', async () => {
    const manager = await embedded();
    const room = manager.create({ ...DEFAULT_SELECTION, game: 'crazy-logs' })!;
    room.join(new Fake('p0'));
    const page = (await plugin.http!(request({ kind: 'page', path: '/', admin: false })))!;
    expect(page).toMatchObject({ status: 200, type: expect.stringContaining('text/html') });
    expect(page.body).toContain('const API="/api/bots"');
    expect(await plugin.http!(request({ kind: 'page', path: '/other' }))).toBeUndefined();
    expect(await plugin.http!(request({ admin: false }))).toMatchObject({ status: 401 });
    const state = (await plugin.http!(request()))!;
    expect(state.status).toBe(200);
    expect((state.body as { join: { auto: boolean } }).join.auto).toBe(false);
    // only the settings that apply inside a game server can be changed
    const cfg = (await plugin.http!(request({ path: '/config' })))!.body as { values: Record<string, unknown> };
    expect(Object.keys(cfg.values)).toContain('ai.mixed');
    expect(Object.keys(cfg.values)).not.toContain('join.pollSeconds');
    expect((await plugin.http!(request({ method: 'PATCH', path: '/config', body: { 'join.pollSeconds': 5 } })))!.status).toBe(400);
    expect((await plugin.http!(request({ method: 'PATCH', path: '/config', body: { 'ai.mixed': 'always' } })))!.status).toBe(200);
    plugin.stop!();
  });

  it('the toggles switch the page, the API and the optional features off', async () => {
    await embedded({ dashboard: false });
    expect(await plugin.http!(request({ kind: 'page', path: '/' }))).toBeUndefined();
    expect((await plugin.http!(request()))!.status).toBe(200);
    plugin.stop!();
    await embedded({ api: false });
    expect(await plugin.http!(request())).toBeUndefined();
    expect(await plugin.http!(request({ kind: 'page', path: '/' }))).toBeUndefined();
    plugin.stop!();
    await embedded({ liveConfig: false, metrics: false });
    expect((await plugin.http!(request({ path: '/config' })))!.status).toBe(404);
    expect((await plugin.http!(request({ path: '/prometheus' })))!.status).toBe(404);
    expect((await plugin.http!(request({ path: '/audit' })))!.status).toBe(404);
    plugin.stop!();
    await embedded({ metrics: true, audit: true });
    const prom = (await plugin.http!(request({ path: '/prometheus' })))!;
    expect(prom.status).toBe(200);
    expect(typeof prom.body).toBe('string');
    expect((await plugin.http!(request({ path: '/audit' })))!.status).toBe(200);
    plugin.stop!();
  });

  it('lets go of seats the match can no longer fill', async () => {
    const manager = await embedded({ mode: 'external' });
    const room = manager.create({ ...DEFAULT_SELECTION, game: 'crazy-logs' })!;
    room.join(new Fake('p0'));
    room.join(new Fake('p1'));
    plugin.onAction!(room, 'p0', { a: 'add', level: 'easy' });
    expect(stateOf(room).seats).toHaveLength(1);
    room.setReady('p1', true);
    room.startMatch('p0');
    manager.update(1 / 60);
    expect(stateOf(room).seats).toEqual([]);
    expect(room.reservedSeats('bots')).toEqual([]);
    plugin.stop!();
  });
});
