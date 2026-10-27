import { describe, expect, it, vi } from 'vitest';
import { CATALOG, DEFAULT_SELECTION, normalizeSelection, registerGames, unregisterGames, type ServerMessage } from '../../shared';
import { effectiveNetworkRate, loadConfig, type ServerConfig } from '../config';
import type { Client } from '../networking/Client';
import { Room, type MatchRecord } from './Room';

const cfg: ServerConfig = {
  profile: 'NORMAL',
  port: 0,
  host: '',
  tickRate: 60,
  networkRate: 20,
  maxPlayersPerRoom: 3,
  maxRooms: 2,
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
  constructor(
    readonly id: string,
    public name = id,
  ) {}
  send(json: string) {
    this.msgs.push(JSON.parse(json));
  }
  close() {}
  of<T extends ServerMessage['t']>(t: T) {
    return this.msgs.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
}
const asClient = (c: FakeClient) => c as unknown as Client;

function setup(players = 2) {
  const room = new Room('ABCD', cfg, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
  const ps = Array.from({ length: players }, (_, i) => new FakeClient(`p${i}`));
  ps.forEach((p) => expect(room.join(asClient(p)).ok).toBe(true));
  return { room, ps };
}

function startMatch(room: Room, ps: FakeClient[]) {
  ps.slice(1).forEach((p) => room.setReady(p.id, true));
  room.startMatch(ps[0].id);
}
const sitOut = (room: Room, id: string) => (room as unknown as { members: Map<string, { sitOut: boolean }> }).members.get(id)?.sitOut;
const run = (room: Room, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) room.update(1 / 60);
};

describe('effective network rate', () => {
  it('reports the rate actually sent for non-divisor NET_RATE', () => {
    const prev = { t: process.env.TICK_RATE, n: process.env.NET_RATE };
    process.env.TICK_RATE = '60';
    process.env.NET_RATE = '25';
    let loaded: ServerConfig;
    try {
      loaded = loadConfig();
    } finally {
      if (prev.t === undefined) delete process.env.TICK_RATE;
      else process.env.TICK_RATE = prev.t;
      if (prev.n === undefined) delete process.env.NET_RATE;
      else process.env.NET_RATE = prev.n;
    }
    expect(loaded.networkRate).toBe(30);
    const room = new Room('ABCD', { ...cfg, networkRate: 25 }, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const p = new FakeClient('p0');
    room.join(asClient(p));
    expect(p.of('WELCOME')[0].config.networkRate).toBe(30);
  });

  it('leaves divisor settings unchanged', () => {
    expect(effectiveNetworkRate(60, 20)).toBe(20);
    expect(effectiveNetworkRate(30, 15)).toBe(15);
    expect(effectiveNetworkRate(30, 60)).toBe(30);
  });
});

describe('spectators', () => {
  it('can watch in the lobby without taking a player slot', () => {
    const { room, ps } = setup(2);
    const s = new FakeClient('s1');
    expect(room.joinSpectator(asClient(s)).ok).toBe(true);
    expect(s.roomCode).toBe('ABCD');
    expect(s.of('WELCOME')[0].spectator).toBe(true);
    const upd = ps[0].of('ROOM_UPDATE').at(-1)!;
    expect(upd.spectators).toBe(1);
    expect(upd.players.map((p) => p.id)).toEqual(['p0', 'p1']);
    // a player slot is still available (max 3)
    expect(room.join(asClient(new FakeClient('p2'))).ok).toBe(true);
  });

  it('joins mid-match, is caught up and receives game state', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    run(room, 4.5);
    const s = new FakeClient('s1');
    expect(room.joinSpectator(asClient(s)).ok).toBe(true);
    expect(s.of('GAME_START')).toHaveLength(1);
    run(room, 0.5);
    expect(s.of('GAME_STATE').length).toBeGreaterThan(0);
    // players can't join a running match
    const late = room.join(asClient(new FakeClient('late')));
    expect(late).toMatchObject({ ok: false, code: 'ROOM_BUSY' });
  });

  it('cannot influence the game', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    run(room, 4.5);
    const s = new FakeClient('s1');
    room.joinSpectator(asClient(s));
    expect(() => room.handleInput('s1', { mx: 1, my: 0, a1: true, a2: false })).not.toThrow();
    room.setReady('s1', true);
    room.startMatch('s1');
    expect(room.phase).toBe('playing');
    expect(room.hostId).toBe('p0');
  });

  it('respects the spectator limit', () => {
    const { room } = setup(1);
    expect(room.joinSpectator(asClient(new FakeClient('a'))).ok).toBe(true);
    expect(room.joinSpectator(asClient(new FakeClient('b'))).ok).toBe(true);
    expect(room.joinSpectator(asClient(new FakeClient('c')))).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('can become a player only in the lobby and only if there is room', () => {
    const { room, ps } = setup(2);
    const s = new FakeClient('s1');
    room.joinSpectator(asClient(s));
    expect(room.promote(asClient(s)).ok).toBe(true);
    expect(room.isSpectator('s1')).toBe(false);
    expect(s.of('WELCOME').at(-1)!.spectator).toBe(false);

    // room is now full (3/3): another spectator can't promote
    const s2 = new FakeClient('s2');
    room.joinSpectator(asClient(s2));
    expect(room.promote(asClient(s2))).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(room.isSpectator('s2')).toBe(true);

    // and never mid-match
    startMatch(room, [...ps, s]);
    expect(room.promote(asClient(s2))).toMatchObject({ ok: false, code: 'ROOM_BUSY' });
  });

  describe('late join between rounds', () => {
    const scoreOf = (room: Room, id: string): number => (room as unknown as { members: Map<string, { score: number }> }).members.get(id)!.score;
    const toResults = (room: Room, ps: FakeClient[]) => {
      startMatch(room, ps);
      for (let i = 0; i < 60 * 120 && room.phase !== 'results'; i++) room.update(1 / 60);
      expect(room.phase).toBe('results');
    };

    it('is refused unless the host turned it on', () => {
      const { room, ps } = setup(2);
      const s = new FakeClient('s1');
      room.joinSpectator(asClient(s));
      toResults(room, ps);
      expect(room.promote(asClient(s))).toMatchObject({ ok: false, code: 'ROOM_BUSY' });
      expect(room.isSpectator('s1')).toBe(true);
    });

    it('seats a watcher at results with a catch-up score', () => {
      const { room, ps } = setup(2);
      const s = new FakeClient('s1');
      room.joinSpectator(asClient(s));
      room.setSettings('p0', { lateJoin: true, catchUp: 100, maxPlayers: 4 });
      toResults(room, ps);
      const lowest = Math.min(...ps.map((p) => scoreOf(room, p.id)));
      expect(room.promote(asClient(s)).ok).toBe(true);
      expect(room.isSpectator('s1')).toBe(false);
      expect(scoreOf(room, 's1')).toBe(lowest);
      expect(s.of('ROOM_UPDATE').at(-1)!.lateJoin).toBe(true);
    });

    it('is still refused while a round is running or when the room is full', () => {
      const { room, ps } = setup(2);
      const s = new FakeClient('s1');
      room.joinSpectator(asClient(s));
      room.setSettings('p0', { lateJoin: true, maxPlayers: 2 });
      toResults(room, ps);
      expect(room.promote(asClient(s))).toMatchObject({ ok: false, code: 'ROOM_FULL' });
      room.setSettings('p0', { catchUp: 0 });
      room.nextGame('p0');
      expect(room.phase).not.toBe('results');
      expect(room.promote(asClient(s))).toMatchObject({ ok: false, code: 'ROOM_BUSY' });
    });
  });

  it('are told when the room closes', () => {
    const { room, ps } = setup(1);
    const s = new FakeClient('s1');
    room.joinSpectator(asClient(s));
    room.leave(ps[0].id);
    room.close();
    expect(s.of('ERROR').at(-1)).toMatchObject({ code: 'ROOM_CLOSED' });
    expect(s.roomCode).toBeNull();
  });

  it('receive results and final scores that were already announced', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    // play out the first game: nobody moves -> they fall at the timeout
    for (let i = 0; i < 60 * 120 && room.phase !== 'results'; i++) room.update(1 / 60);
    expect(room.phase).toBe('results');
    const s = new FakeClient('s1');
    room.joinSpectator(asClient(s));
    expect(s.of('GAME_RESULT')).toHaveLength(1);
    expect(s.of('SCORE_UPDATE')).toHaveLength(1);
  });
});

describe('operator selection reset', () => {
  it('only idle rooms may be reset, and a reset goes back to the default mix and clears ready', () => {
    const { room, ps } = setup(2);
    expect(room.canResetSelection).toBe(true);
    room.setReady(ps[1].id, true);
    room.adminResetSelection();
    expect(room.selection).toEqual(DEFAULT_SELECTION);
    expect(room.size).toBe(2);
    startMatch(room, ps);
    expect(room.phase).not.toBe('lobby');
    expect(room.canResetSelection).toBe(false);
  });
});

describe('match history hook', () => {
  it('reports each finished match once, with its rounds and ranking', () => {
    const records: MatchRecord[] = [];
    const sel = normalizeSelection(undefined, undefined, undefined, [
      { game: 'crazy-logs', options: { roundsToWin: 1 } },
      { game: 'crazy-logs', options: { roundsToWin: 1 } },
    ])!;
    const room = new Room('ABCD', cfg, sel, { matchFinished: (m) => records.push(m) });
    const ps = [new FakeClient('p0', 'Ann'), new FakeClient('p1', 'Bob')];
    ps.forEach((p) => room.join(asClient(p)));
    startMatch(room, ps);
    for (let i = 0; i < 60 * 900 && room.phase !== 'finished'; i++) room.update(1 / 60);
    expect(room.phase).toBe('finished');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ room: 'ABCD' });
    expect(records[0]!.games.map((g) => g.id)).toEqual(['crazy-logs', 'crazy-logs']);
    // guests are never stored under the name they picked
    expect(records[0]!.ranking.map((r) => r.name)).toEqual(['Guest', 'Guest']);
    expect(records[0]!.ranking.every((r) => r.signedIn === false)).toBe(true);
    expect(records[0]!.durationSec).toBeGreaterThanOrEqual(0);
  });
});

describe('custom playlist', () => {
  it('runs exactly its rounds, with per-round totals, then finishes', () => {
    const sel = normalizeSelection(undefined, undefined, undefined, [
      { game: 'crazy-logs', options: { roundsToWin: 1 } },
      { game: 'crazy-logs', options: { roundsToWin: 1 } },
      { game: 'crazy-logs', options: { roundsToWin: 1 } },
    ])!;
    const room = new Room('ABCD', cfg, sel);
    const ps = [new FakeClient('p0'), new FakeClient('p1')];
    ps.forEach((p) => room.join(asClient(p)));
    expect(ps[0].of('WELCOME')[0].config.totalGames).toBe(3);
    startMatch(room, ps);
    for (let i = 0; i < 60 * 900 && room.phase !== 'finished'; i++) room.update(1 / 60);
    expect(room.phase).toBe('finished');
    const starts = ps[0].of('GAME_START');
    expect(starts).toHaveLength(3);
    expect(starts.every((s) => s.total === 3)).toBe(true);
    expect(starts.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('host can switch a room to a playlist in the lobby', () => {
    const { room, ps } = setup(2);
    const sel = normalizeSelection(undefined, undefined, undefined, [{ game: 'crazy-logs' }])!;
    room.setSelection(ps[0].id, sel);
    expect(room.totalGames).toBe(1);
    expect(ps[1].of('ROOM_UPDATE').at(-1)!.selection.playlist).toHaveLength(1);
  });
});

describe('profiles', () => {
  const asProfiled = (id: string, color: number | null, profileId: string | null = null) => {
    const c = new FakeClient(id) as FakeClient & Record<string, unknown>;
    c.preferredColor = color;
    c.profileId = profileId;
    c.looks = { blob: { hat: 3 } };
    c.avatar = 'blob';
    return c;
  };

  it('grants the preferred colour and falls back when it is taken', () => {
    const room = new Room('ABCD', cfg, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const a = asProfiled('a', 5);
    const b = asProfiled('b', 5);
    const c = asProfiled('c', null);
    for (const p of [a, b, c]) expect(room.join(asClient(p)).ok).toBe(true);
    const players = c.of('ROOM_UPDATE').at(-1)!.players;
    const colors = players.map((p) => p.color);
    expect(colors[0]).toBe(5);
    expect(new Set(colors).size).toBe(3);
    expect(players[0].looks.blob.hat).toBe(3);
    expect(players[0].avatar).toBe('blob');
  });

  it('credits stats once per game and match, only to profiled players', () => {
    const calls: { id: string; delta: any }[] = [];
    const sel = normalizeSelection('crazy-logs', undefined, { roundsToWin: 1 })!;
    const room = new Room('ABCD', cfg, sel, {
      recordResult: (id, delta) => calls.push({ id, delta }),
    });
    const ps = [asProfiled('p0', null, 'prof-0'), asProfiled('p1', null, null)];
    ps.forEach((p) => room.join(asClient(p)));
    startMatch(room, ps);
    for (let i = 0; i < 60 * 900 && room.phase !== 'finished'; i++) room.update(1 / 60);
    expect(room.phase).toBe('finished');
    expect(calls.every((c) => c.id === 'prof-0')).toBe(true);
    expect(calls.filter((c) => c.delta.game)).toHaveLength(1);
    expect(calls.filter((c) => c.delta.match)).toHaveLength(1);
  });
});

describe('host management', () => {
  const lastErr = (c: FakeClient) => c.of('ERROR').at(-1);

  it('is host-only', () => {
    const { room, ps } = setup(3);
    const [, a, b] = ps;
    room.kick(a.id, b.id);
    expect(lastErr(a)).toMatchObject({ code: 'NOT_HOST' });
    room.makeHost(a.id, b.id);
    room.setSettings(a.id, { locked: true });
    room.setSelection(a.id, { ...DEFAULT_SELECTION, game: 'ballistix' });
    room.resetName(a.id, b.id);
    expect(a.of('ERROR').filter((e) => e.code === 'NOT_HOST')).toHaveLength(5);
    expect(room.size).toBe(3);
    expect(room.locked).toBe(false);
  });

  it('kick removes a player for good and tells them', () => {
    const { room, ps } = setup(3);
    const token = ps[1].of('WELCOME')[0].resume!;
    room.kick(ps[0].id, ps[1].id);
    expect(room.size).toBe(2);
    expect(ps[1].of('ERROR').at(-1)).toMatchObject({ code: 'KICKED' });
    expect(ps[1].roomCode).toBeNull();
    expect(ps[2].of('PLAYER_LEFT').at(-1)).toMatchObject({ id: ps[1].id });
    // the old seat cannot be re-attached
    const again = new FakeClient('x1');
    expect(room.resume(asClient(again), token)).toBe(false);
  });

  it('cannot kick yourself or an unknown id', () => {
    const { room, ps } = setup(2);
    room.kick(ps[0].id, ps[0].id);
    room.kick(ps[0].id, 'nobody');
    expect(room.size).toBe(2);
    expect(ps[0].of('ERROR').filter((e) => e.code === 'BAD_STATE')).toHaveLength(2);
  });

  it('kicks a player in the middle of a match', () => {
    const { room, ps } = setup(3);
    startMatch(room, ps);
    run(room, 4);
    room.kick(ps[0].id, ps[2].id);
    expect(room.size).toBe(2);
    expect(() => run(room, 1)).not.toThrow();
  });

  it('kicks a spectator', () => {
    const { room, ps } = setup(2);
    const s = new FakeClient('s1');
    room.joinSpectator(asClient(s));
    expect(ps[0].of('ROOM_UPDATE').at(-1)!.watchers).toEqual([{ id: 's1', name: 's1' }]);
    room.kick(ps[0].id, 's1');
    expect(room.spectatorCount).toBe(0);
    expect(s.of('ERROR').at(-1)).toMatchObject({ code: 'KICKED' });
  });

  it('a returning player sits the round out, unless the game implements addPlayer', () => {
    const { room, ps } = setup(2);
    const tok = ps[1].of('WELCOME')[0].resume!;
    startMatch(room, ps);
    const mg = (room as unknown as { minigame: { addPlayer?: unknown } }).minigame;
    room.leave('p1', asClient(ps[1]));
    expect(room.resume(asClient(new FakeClient('b1', 'x')), tok)).toBe(true);
    expect(sitOut(room, 'p1')).toBe(true);

    const addPlayer = vi.fn();
    mg.addPlayer = addPlayer;
    room.leave('p1');
    expect(room.resume(asClient(new FakeClient('b2', 'y')), tok)).toBe(true);
    expect(addPlayer).toHaveBeenCalledWith({ id: 'p1', name: 'p1' });
    expect(sitOut(room, 'p1')).toBe(false);
  });

  it('sends the stats a game reports with the round result', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    const mg = (room as unknown as { minigame: { getStats?: unknown } }).minigame;
    mg.getStats = () => ({ p0: { hits: 3 } });
    run(room, 400);
    expect(ps[0].of('GAME_RESULT')[0]!.stats).toEqual({ p0: { hits: 3 } });
  });

  it('lock stops newcomers but not a returning seat', () => {
    const { room, ps } = setup(2);
    const token = ps[1].of('WELCOME')[0].resume!;
    startMatch(room, ps);
    room.setSettings(ps[0].id, { locked: true });
    expect(room.joinSpectator(asClient(new FakeClient('w')))).toMatchObject({ ok: false, code: 'ROOM_LOCKED' });
    room.leave(ps[1].id);
    const back = new FakeClient('p1b');
    expect(room.resume(asClient(back), token)).toBe(true);
    room.setSettings(ps[0].id, { locked: false });
    expect(room.joinSpectator(asClient(new FakeClient('w2'))).ok).toBe(true);
  });

  it('locked lobby rejects players too', () => {
    const { room, ps } = setup(1);
    room.setSettings(ps[0].id, { locked: true });
    expect(room.join(asClient(new FakeClient('n')))).toMatchObject({ ok: false, code: 'ROOM_LOCKED' });
  });

  it('player cap: enforced, bounded by current size and by the server', () => {
    const { room, ps } = setup(2);
    room.setSettings(ps[0].id, { maxPlayers: 2 });
    expect(room.maxPlayers).toBe(2);
    expect(room.join(asClient(new FakeClient('n')))).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    room.setSettings(ps[0].id, { maxPlayers: 1 }); // below the current size
    expect(room.maxPlayers).toBe(2);
    room.setSettings(ps[0].id, { maxPlayers: 50 });
    expect(room.maxPlayers).toBe(cfg.maxPlayersPerRoom);
    expect(room.join(asClient(new FakeClient('n2'))).ok).toBe(true);
  });

  it('hands the host role over to a connected player only', () => {
    const { room, ps } = setup(3);
    room.leave(ps[2].id); // lobby: seat freed
    room.makeHost(ps[0].id, 'ghost');
    expect(room.hostId).toBe(ps[0].id);
    room.makeHost(ps[0].id, ps[1].id);
    expect(room.hostId).toBe(ps[1].id);
    room.kick(ps[0].id, ps[1].id); // old host is no longer allowed
    expect(lastErr(ps[0])).toMatchObject({ code: 'NOT_HOST' });
  });

  it('changes the game in the lobby only, and clears ready flags', () => {
    const { room, ps } = setup(2);
    room.setReady(ps[1].id, true);
    room.setSelection(ps[0].id, { ...DEFAULT_SELECTION, game: 'ballistix' });
    expect(room.selection.game).toBe('ballistix');
    expect(ps[0].of('ROOM_UPDATE').at(-1)!.players.every((p) => !p.ready)).toBe(true);
    room.setReady(ps[1].id, true);
    startMatch(room, ps);
    room.setSelection(ps[0].id, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    expect(room.selection.game).toBe('ballistix');
    expect(lastErr(ps[0])).toMatchObject({ code: 'BAD_STATE' });
  });

  it('resets a name to a unique "Player"', () => {
    const { room, ps } = setup(3);
    room.resetName(ps[0].id, ps[1].id);
    room.resetName(ps[0].id, ps[2].id);
    const names = ps[0].of('ROOM_UPDATE').at(-1)!.players.map((p) => p.name);
    expect(names).toContain('Player');
    expect(names).toContain('Player 2');
  });
});

describe('restart votes', () => {
  const lastVote = (c: FakeClient) => c.of('VOTE_UPDATE').at(-1)!;
  const playing = (n: number) => {
    const s = setup(n);
    startMatch(s.room, s.ps);
    run(s.room, 4.5);
    expect(s.room.phase).toBe('playing');
    return s;
  };

  it('a solo player restarts instantly; the round index and scores are kept', () => {
    const { room, ps } = playing(1);
    const before = ps[0].of('GAME_START').length;
    room.startVote('p0', 'round');
    expect(lastVote(ps[0])).toMatchObject({ vote: null, outcome: 'passed', kind: 'round' });
    expect(ps[0].of('GAME_START')).toHaveLength(before + 1);
    expect(ps[0].of('GAME_START').at(-1)!.index).toBe(0);
    expect(room.phase).toBe('countdown');
  });

  it('two players both need to agree', () => {
    const { room, ps } = playing(2);
    room.startVote('p0', 'round');
    expect(lastVote(ps[1]).vote).toMatchObject({ kind: 'round', needed: 2, total: 2, yes: ['p0'] });
    expect(room.phase).toBe('playing');
    room.castVote('p1', true);
    expect(lastVote(ps[0])).toMatchObject({ outcome: 'passed' });
    expect(room.phase).toBe('countdown');
  });

  it('three players: a majority passes, a majority of no fails', () => {
    const a = playing(3);
    a.room.startVote('p0', 'round');
    a.room.castVote('p2', true);
    expect(lastVote(a.ps[0])).toMatchObject({ outcome: 'passed' });

    const b = playing(3);
    b.room.startVote('p0', 'round');
    b.room.castVote('p1', false);
    expect(lastVote(b.ps[0]).vote).not.toBeNull(); // still open: p2 could tip it
    b.room.castVote('p2', false);
    expect(lastVote(b.ps[0])).toMatchObject({ vote: null, outcome: 'failed' });
    expect(b.room.phase).toBe('playing');
  });

  it('times out as failed, then enforces a cooldown', () => {
    const { room, ps } = playing(2);
    room.startVote('p0', 'round');
    (room as unknown as { vote: { left: number } }).vote.left = 0.05; // fast-forward the 15 s
    run(room, 0.1);
    expect(lastVote(ps[0])).toMatchObject({ vote: null, outcome: 'failed' });
    room.startVote('p0', 'round');
    expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'VOTE_COOLDOWN' });
    (room as unknown as { voteCooldown: number }).voteCooldown = 0.05;
    run(room, 0.1);
    room.startVote('p0', 'round');
    expect(lastVote(ps[0]).vote).not.toBeNull();
  });

  it('only one vote at a time', () => {
    const { room, ps } = playing(3);
    room.startVote('p0', 'round');
    room.startVote('p1', 'match');
    expect(ps[1].of('ERROR').at(-1)).toMatchObject({ code: 'VOTE_ACTIVE' });
  });

  it('a player leaving re-evaluates the vote', () => {
    const { room, ps } = playing(3);
    room.startVote('p0', 'round'); // needs 2 of 3
    room.leave('p2'); // now 2 connected -> needs 2, p0 only
    expect(lastVote(ps[0]).vote).toMatchObject({ needed: 2, total: 2 });
    room.castVote('p1', true);
    expect(lastVote(ps[0])).toMatchObject({ outcome: 'passed' });
  });

  it('spectators can see but not start or cast votes', () => {
    const { room, ps } = playing(2);
    const s = new FakeClient('s1');
    room.joinSpectator(asClient(s));
    room.startVote('s1', 'round');
    expect(room.phase).toBe('playing');
    room.startVote('p0', 'round');
    expect(lastVote(s).vote).not.toBeNull();
    room.castVote('s1', true);
    expect(lastVote(ps[0]).vote!.yes).toEqual(['p0']);
    // joining mid-vote catches up
    const late = new FakeClient('s2');
    room.joinSpectator(asClient(late));
    expect(lastVote(late).vote).not.toBeNull();
  });

  it('restart match resets scores and the round counter', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    for (let i = 0; i < 60 * 120 && room.phase !== 'results'; i++) room.update(1 / 60);
    expect(room.phase).toBe('results');
    room.update(1 / 60);
    room.startVote('p0', 'match');
    room.castVote('p1', true);
    expect(room.phase).toBe('countdown');
    expect(ps[0].of('GAME_START').at(-1)!.index).toBe(0);
    const scores = ps[0].of('ROOM_UPDATE').at(-1)!.players.map((p) => p.score);
    expect(scores).toEqual([0, 0]);
  });

  it('round restart is refused in the results phase and lobby; a running vote is cancelled when the round ends', () => {
    const { room, ps } = setup(2);
    room.startVote('p0', 'round');
    expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'BAD_STATE' });
    startMatch(room, ps);
    run(room, 55); // late in the 60 s round: the 15 s vote is still open when it ends
    room.startVote('p0', 'round');
    for (let i = 0; i < 60 * 120 && room.phase !== 'results'; i++) room.update(1 / 60);
    expect(lastVote(ps[0])).toMatchObject({ vote: null, outcome: 'cancelled' });
    room.startVote('p0', 'round');
    expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'BAD_STATE' });
  });
});

describe('unique player names', () => {
  it('treats names as duplicates case-insensitively and ignoring invisible chars', () => {
    const room = new Room('ABCD', cfg, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const names = ['Ana', 'ANA', 'a\u200bna'];
    const ps = names.map((n, i) => new FakeClient(`p${i}`, n));
    ps.forEach((p) => expect(room.join(asClient(p)).ok).toBe(true));
    const joined = ps.map((p) => p.of('WELCOME')[0]);
    expect(joined.length).toBe(3);
    const all = ps[2].of('ROOM_UPDATE').at(-1)!.players.map((p) => p.name);
    expect(all).toEqual(['Ana', 'ANA 2', 'a\u200bna 3']);
  });
});

describe('reconnect / resume', () => {
  const token = (c: FakeClient) => c.of('WELCOME')[0].resume!;

  it('issues a token only to its owner and never broadcasts it', () => {
    const { room, ps } = setup(2);
    expect(token(ps[0])).toMatch(/^[0-9a-f]{32}$/);
    expect(token(ps[0])).not.toBe(token(ps[1]));
    for (const p of ps) {
      for (const m of p.msgs) {
        if (m.t === 'WELCOME') continue;
        expect(JSON.stringify(m)).not.toContain(token(ps[0]));
        expect(JSON.stringify(m)).not.toContain(token(ps[1]));
      }
    }
    const spec = new FakeClient('s0');
    room.joinSpectator(asClient(spec));
    expect(spec.of('WELCOME')[0].resume).toBeUndefined();
  });

  it('restores id, name and score within grace and replaces the socket', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    for (let i = 0; i < 60 * 120 && room.phase !== 'results'; i++) room.update(1 / 60);
    const tok = token(ps[1]);
    room.leave('p1', asClient(ps[1]));
    run(room, 5);
    const again = new FakeClient('zzz', 'other');
    expect(room.resume(asClient(again), tok)).toBe(true);
    expect(again.id).toBe('p1');
    expect(again.of('WELCOME')[0]).toMatchObject({ id: 'p1', spectator: false, resume: tok });
    const upd = ps[0].of('ROOM_UPDATE').at(-1)!;
    const me = upd.players.find((p) => p.id === 'p1')!;
    expect(me).toMatchObject({ connected: true, name: 'p1' });
    expect(room.connectedCount).toBe(2);
    // caught up on the results like a spectator
    expect(again.of('GAME_RESULT').length).toBe(1);
  });

  it('keeps the score and leaves the player out of the running round', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    run(room, 4.5);
    const tok = token(ps[1]);
    room.leave('p1', asClient(ps[1]));
    const again = new FakeClient('n1');
    expect(room.resume(asClient(again), tok)).toBe(true);
    expect(again.of('GAME_START').length).toBe(1);
    room.handleInput('p1', { mx: 1, my: 0, a1: false, a2: false }); // ignored, no throw
    for (let i = 0; i < 60 * 120 && room.phase !== 'results'; i++) room.update(1 / 60);
    const res = again.of('GAME_RESULT')[0];
    expect(res.placements.map((p) => p.id).sort()).toEqual(['p0', 'p1']);
    // full player again next game
    room.nextGame('p0');
    expect(room.phase).toBe('countdown');
    const st = again.msgs.filter((m) => m.t === 'GAME_STATE').at(-1) as any;
    expect(JSON.stringify(st.state)).toContain('p1');
  });

  it('warns once before an idle lobby is reaped, and again after activity', () => {
    const { room, ps } = setup(2); // idleRoomSeconds: 600
    const notices = () => ps[0].of('NOTICE').filter((n) => n.code === 'IDLE_CLOSING');
    run(room, 530);
    expect(notices()).toHaveLength(0);
    run(room, 20); // 60 s before the limit
    expect(notices()).toHaveLength(1);
    expect(notices()[0]!.seconds).toBe(60);
    run(room, 30);
    expect(notices()).toHaveLength(1);
    room.touch(); // activity resets the countdown
    run(room, 545);
    expect(notices()).toHaveLength(2);
  });

  it('the idle warning lead follows idleWarnSeconds, is capped at half the limit, and 0 disables it', () => {
    const withCfg = (over: Partial<typeof cfg>) => {
      const room = new Room('ABCD', { ...cfg, ...over }, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
      const p = new FakeClient('p0');
      room.join(asClient(p));
      return { room, p };
    };
    const warned = (p: FakeClient) => p.of('NOTICE').filter((n) => n.code === 'IDLE_CLOSING');

    const a = withCfg({ idleRoomSeconds: 100, idleWarnSeconds: 20 });
    run(a.room, 79);
    expect(warned(a.p)).toHaveLength(0);
    run(a.room, 2);
    expect(warned(a.p)[0]).toMatchObject({ seconds: 20 });

    const b = withCfg({ idleRoomSeconds: 40, idleWarnSeconds: 300 }); // capped at 20
    run(b.room, 21);
    expect(warned(b.p)[0]).toMatchObject({ seconds: 20 });

    const c = withCfg({ idleRoomSeconds: 100, idleWarnSeconds: 0 });
    run(c.room, 99);
    expect(warned(c.p)).toHaveLength(0);
  });

  it('an admin kick tells the player the reason and ban length', () => {
    const { room, ps } = setup(2);
    expect(room.adminKick('p1', 'BANNED', { reason: 'spam', minutes: 30 })).toBe(true);
    expect(ps[1].of('ERROR').at(-1)).toMatchObject({ code: 'BANNED', reason: 'spam', minutes: 30 });
  });

  it('a player kicked by the host cannot rejoin or watch with the same profile', () => {
    const { room, ps } = setup(2);
    const victim = new FakeClient('v');
    (victim as unknown as { profileId: string }).profileId = 'prof-v';
    expect(room.join(asClient(victim)).ok).toBe(true);
    room.kick(ps[0].id, 'v');
    const again = new FakeClient('v2');
    (again as unknown as { profileId: string }).profileId = 'prof-v';
    expect(room.join(asClient(again))).toMatchObject({ ok: false, code: 'KICKED' });
    expect(room.joinSpectator(asClient(again))).toMatchObject({ ok: false, code: 'KICKED' });
    expect(room.join(asClient(new FakeClient('other'))).ok).toBe(true); // others are unaffected
  });

  it('names who is not ready, and the host can force-start anyway', () => {
    const { room, ps } = setup(3);
    room.startMatch(ps[0].id);
    expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'NOT_READY', message: 'Waiting for: p1, p2' });
    expect(room.phase).toBe('lobby');
    room.startMatch(ps[0].id, true);
    expect(room.phase).not.toBe('lobby');
  });

  it('keeps a lobby seat through a drop, and frees it at once on a deliberate leave', () => {
    const { room, ps } = setup(3);
    const tok = token(ps[1]);
    room.leave('p1', asClient(ps[1])); // drop
    const upd = () => ps[0].of('ROOM_UPDATE').at(-1)!;
    expect(upd().players.find((p) => p.id === 'p1')).toMatchObject({ connected: false });
    const back = new FakeClient('nn', 'other');
    expect(room.resume(asClient(back), tok)).toBe(true);
    expect(back.id).toBe('p1');
    expect(upd().players.find((p) => p.id === 'p1')).toMatchObject({ connected: true });

    room.leave('p2', asClient(ps[2]), true); // pressed Leave
    expect(upd().players.some((p) => p.id === 'p2')).toBe(false);
  });

  it('drops a lobby seat when the grace period ends, and a dropped seat does not block ready or capacity', () => {
    const { room, ps } = setup(2);
    room.setSettings(ps[0].id, { maxPlayers: 2 });
    room.leave('p1', asClient(ps[1]));
    expect(room.join(asClient(new FakeClient('n'))).ok).toBe(true); // the dropped seat is not counted
    run(room, 61);
    expect(ps[0].of('ROOM_UPDATE').at(-1)!.players.some((p) => p.id === 'p1')).toBe(false);
  });

  it('falls back (returns false) for a wrong token, expired grace and when disabled', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    const tok = token(ps[1]);
    room.leave('p1', asClient(ps[1]));
    expect(room.resume(asClient(new FakeClient('a')), 'f'.repeat(32))).toBe(false);
    run(room, 61);
    expect(room.resume(asClient(new FakeClient('b')), tok)).toBe(false);

    const off = new Room('ABCD', { ...cfg, reconnectGraceSeconds: 0 }, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const a = new FakeClient('a0');
    off.join(asClient(a));
    expect(a.of('WELCOME')[0].resume).toBeUndefined();
    expect(off.resume(asClient(new FakeClient('c')), 'a'.repeat(32))).toBe(false);
  });

  it('hands the host role to the first player back when everyone dropped', () => {
    const { room, ps } = setup(3);
    const toks = ps.map(token);
    ps.forEach((p) => room.leave(p.id, asClient(p)));
    const back1 = new FakeClient('n1');
    const back2 = new FakeClient('n2');
    expect(room.resume(asClient(back1), toks[1])).toBe(true);
    expect(room.resume(asClient(back2), toks[2])).toBe(true);
    expect(back1.of('ROOM_UPDATE').at(-1)!.hostId).toBe('p1');
    room.setReady('p2', true);
    room.startMatch('p1');
    expect(back1.of('ERROR').some((e) => e.code === 'NOT_HOST')).toBe(false);
    expect(room.phase).toBe('countdown');
  });

  it('keeps a working host when the dropped host seat expires in the lobby', () => {
    const { room, ps } = setup(3);
    const toks = ps.map(token);
    ps.forEach((p) => room.leave(p.id, asClient(p)));
    const back1 = new FakeClient('n1');
    const back2 = new FakeClient('n2');
    expect(room.resume(asClient(back1), toks[1])).toBe(true);
    expect(room.resume(asClient(back2), toks[2])).toBe(true);
    run(room, 61);
    expect(room.size).toBe(2);
    room.setReady('p2', true);
    room.startMatch('p1');
    expect(room.phase).toBe('countdown');
  });

  it('gives the host role back to the original host who returns within the grace period', () => {
    const { room, ps } = setup(3);
    const tok = token(ps[0]);
    room.leave('p0', asClient(ps[0]));
    expect(room.hostId).toBe('p1');
    expect(ps[2].of('NOTICE').at(-1)).toMatchObject({ code: 'HOST_CHANGED', id: 'p1' });
    const back = new FakeClient('n0');
    expect(room.resume(asClient(back), tok)).toBe(true);
    expect(room.hostId).toBe('p0');
    expect(ps[2].of('NOTICE').at(-1)).toMatchObject({ code: 'HOST_CHANGED', id: 'p0' });
  });

  it('does not give the role back after an explicit hand-over', () => {
    const { room, ps } = setup(3);
    const tok = token(ps[0]);
    room.leave('p0', asClient(ps[0]));
    room.makeHost('p1', 'p2');
    expect(room.resume(asClient(new FakeClient('n0')), tok)).toBe(true);
    expect(room.hostId).toBe('p2');
  });

  it('passes the host role to the most recently active player when the host goes quiet', () => {
    const idleCfg = { ...cfg, hostIdleSeconds: 30 };
    const room = new Room('ABCD', idleCfg, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const ps = [new FakeClient('p0'), new FakeClient('p1'), new FakeClient('p2')];
    ps.forEach((p) => room.join(asClient(p)));
    room.noteActive('p0');
    run(room, 60); // nobody acted after the host: nothing changes
    expect(room.hostId).toBe('p0');
    room.noteActive('p2');
    run(room, 29);
    expect(room.hostId).toBe('p0');
    room.noteActive('p0'); // the host is back
    run(room, 29);
    expect(room.hostId).toBe('p0');
    room.noteActive('p2');
    run(room, 31);
    expect(room.hostId).toBe('p2');
  });

  it('a host in a running round is never replaced for being quiet', () => {
    const room = new Room('ABCD', { ...cfg, hostIdleSeconds: 5 }, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const ps = [new FakeClient('p0'), new FakeClient('p1')];
    ps.forEach((p) => room.join(asClient(p)));
    room.setReady('p1', true);
    room.startMatch('p0');
    room.noteActive('p1');
    run(room, 4);
    expect(room.hostId).toBe('p0');
  });

  it('one seat per profile: a second join takes the old seat over, or is refused without a token', () => {
    const room = new Room('ABCD', cfg, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const a = new FakeClient('a');
    (a as any).profileId = 'prof1';
    room.join(asClient(a));
    const b = new FakeClient('b');
    (b as any).profileId = 'prof1';
    expect(room.join(asClient(b))).toEqual({ ok: true });
    expect(room.size).toBe(1);
    expect(b.id).toBe('a'); // took the seat over
    const noGrace = new Room('ABCD', { ...cfg, reconnectGraceSeconds: 0 }, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const c = new FakeClient('c');
    (c as any).profileId = 'prof2';
    noGrace.join(asClient(c));
    const d = new FakeClient('d');
    (d as any).profileId = 'prof2';
    expect(noGrace.join(asClient(d))).toMatchObject({ ok: false, code: 'ALREADY_IN_ROOM' });
  });

  it('an operator can hand the host role to a connected player', () => {
    const { room, ps } = setup(2);
    expect(room.adminMakeHost('nobody')).toBe(false);
    expect(room.adminMakeHost('p1')).toBe(true);
    expect(room.hostId).toBe('p1');
    expect(ps[0].of('NOTICE').at(-1)).toMatchObject({ code: 'HOST_CHANGED', id: 'p1' });
  });

  it('replaces a half-open socket and ignores its late close', () => {
    const { room, ps } = setup(2);
    let closed = false;
    ps[1].close = () => {
      closed = true;
    };
    const again = new FakeClient('n2');
    expect(room.resume(asClient(again), token(ps[1]))).toBe(true);
    expect(closed).toBe(true);
    room.leave('p1', asClient(ps[1])); // old socket's close event
    expect(room.connectedCount).toBe(2);
    room.leave(again.id, asClient(again));
    expect(room.connectedCount).toBe(1);
  });

  it('stays resumable while in grace and is reaped as abandoned afterwards', () => {
    const { room, ps } = setup(2);
    startMatch(room, ps);
    room.leave('p0', asClient(ps[0]));
    room.leave('p1', asClient(ps[1]));
    expect(room.connectedCount).toBe(0);
    expect(room.hasResumable()).toBe(true);
    run(room, 61);
    expect(room.hasResumable()).toBe(false);
  });
});

describe('room password', () => {
  const protectedRoom = () => {
    const { room, ps } = setup(1);
    room.setSettings(ps[0].id, { password: 'sesame' });
    return { room, host: ps[0] };
  };

  it('asks newcomers and spectators for it, and accepts the right one', () => {
    const { room } = protectedRoom();
    expect(room.passwordProtected).toBe(true);
    expect(room.join(asClient(new FakeClient('n1')))).toMatchObject({ ok: false, code: 'PASSWORD_REQUIRED' });
    expect(room.join(asClient(new FakeClient('n2')), 'nope')).toMatchObject({ ok: false, code: 'WRONG_PASSWORD' });
    expect(room.joinSpectator(asClient(new FakeClient('s1')))).toMatchObject({ ok: false, code: 'PASSWORD_REQUIRED' });
    expect(room.join(asClient(new FakeClient('n3')), 'sesame').ok).toBe(true);
    expect(room.joinSpectator(asClient(new FakeClient('s2')), 'sesame').ok).toBe(true);
  });

  it('treats an unusable (empty) password as a wrong guess that counts toward the lockout', () => {
    const { room } = protectedRoom();
    for (let i = 0; i < 5; i++) {
      expect(room.join(asClient(new FakeClient(`e${i}`)), '')).toMatchObject({ ok: false, code: 'WRONG_PASSWORD', message: 'Wrong password' });
    }
    expect(room.join(asClient(new FakeClient('e5')), 'sesame')).toMatchObject({ ok: false, message: expect.stringMatching(/Too many/) });
  });

  it('lets an admitted spectator promote to player without the password', () => {
    const { room } = protectedRoom();
    const s = new FakeClient('s1');
    expect(room.joinSpectator(asClient(s), 'sesame').ok).toBe(true);
    expect(room.promote(asClient(s)).ok).toBe(true);
    expect(room.isSpectator('s1')).toBe(false);
  });

  it('tells only the host the password, and everyone that it is protected', () => {
    const { room, host } = protectedRoom();
    const guest = new FakeClient('g');
    expect(room.join(asClient(guest), 'sesame').ok).toBe(true);
    expect(host.of('ROOM_PASSWORD').at(-1)).toEqual({ t: 'ROOM_PASSWORD', password: 'sesame' });
    expect(guest.of('ROOM_PASSWORD')).toHaveLength(0);
    expect(guest.of('ROOM_UPDATE').at(-1)!.passwordProtected).toBe(true);
    expect(JSON.stringify(guest.msgs)).not.toContain('sesame');
  });

  it('can be changed and removed by the host only', () => {
    const { room, host } = protectedRoom();
    const guest = new FakeClient('g');
    room.join(asClient(guest), 'sesame');
    room.setSettings(guest.id, { password: null });
    expect(room.passwordProtected).toBe(true);
    room.setSettings(host.id, { password: 'other' });
    expect(room.join(asClient(new FakeClient('x')), 'sesame')).toMatchObject({ ok: false, code: 'WRONG_PASSWORD' });
    room.setSettings(host.id, { password: null });
    expect(room.passwordProtected).toBe(false);
    expect(room.join(asClient(new FakeClient('y'))).ok).toBe(true);
  });

  it('refuses further attempts for a while after 5 wrong guesses', () => {
    const { room } = protectedRoom();
    for (let i = 0; i < 5; i++) room.join(asClient(new FakeClient(`b${i}`)), 'bad');
    // blocked: even the right password is refused for a moment
    expect(room.join(asClient(new FakeClient('late')), 'sesame')).toMatchObject({ ok: false, code: 'WRONG_PASSWORD' });
  });

  it('does not let one IP lock out joiners from another', () => {
    const { room } = protectedRoom();
    const from = (id: string, ip: string) => Object.assign(new FakeClient(id), { ip });
    for (let i = 0; i < 5; i++) room.join(asClient(from(`a${i}`, '1.1.1.1')), 'bad');
    expect(room.join(asClient(from('a-late', '1.1.1.1')), 'sesame')).toMatchObject({ ok: false });
    expect(room.join(asClient(from('friend', '2.2.2.2')), 'sesame').ok).toBe(true);
  });
});

describe('per-game player limits', () => {
  const big: ServerConfig = { ...cfg, maxPlayersPerRoom: 8 };
  const ballistix = normalizeSelection('ballistix', 'all', {})!;
  const join = (room: Room, n: number) => {
    const ps = Array.from({ length: n }, (_, i) => new FakeClient(`q${i}`));
    ps.forEach((p) => expect(room.join(asClient(p)).ok).toBe(true));
    return ps;
  };

  it('clamps a new room to the limit of its game', () => {
    expect(new Room('AAAA', big, ballistix).maxPlayers).toBe(4);
    expect(new Room('BBBB', big, DEFAULT_SELECTION).maxPlayers).toBe(8);
    const room = new Room('CCCC', big, ballistix);
    join(room, 4);
    const late = new FakeClient('late');
    expect(room.join(asClient(late))).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('refuses a game that cannot hold the seated players, and keeps the selection', () => {
    const room = new Room('DDDD', big, DEFAULT_SELECTION);
    const ps = join(room, 5);
    room.setSelection(ps[0].id, ballistix);
    expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'TOO_MANY_PLAYERS' });
    expect(room.selection).toEqual(DEFAULT_SELECTION);
    expect(room.maxPlayers).toBe(8);
  });

  it('accepts it at the limit, and restores the cap when going back to the mix', () => {
    const room = new Room('EEEE', big, DEFAULT_SELECTION);
    const ps = join(room, 4);
    room.setSelection(ps[0].id, ballistix);
    expect(room.selection).toEqual(ballistix);
    expect(room.maxPlayers).toBe(4);
    room.setSelection(ps[0].id, DEFAULT_SELECTION);
    expect(room.maxPlayers).toBe(8);
  });

  it('judges a custom playlist by its strictest round', () => {
    const room = new Room('FFFF', big, DEFAULT_SELECTION);
    const ps = join(room, 5);
    const list = normalizeSelection(undefined, undefined, undefined, [
      { game: 'crazy-logs', variant: 'all', options: {} },
      { game: 'ballistix', variant: 'smashball', options: {} },
    ])!;
    room.setSelection(ps[0].id, list);
    expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'TOO_MANY_PLAYERS' });
  });

  it('does not let the host raise the cap above the game limit', () => {
    const room = new Room('GGGG', big, ballistix);
    const host = join(room, 1)[0];
    room.setSettings(host.id, { maxPlayers: 8 });
    expect(room.maxPlayers).toBe(4);
  });
});

describe('rounds to win and end-of-match votes', () => {
  const finished = (roundsToWin: number, players = 2) => {
    const sel = normalizeSelection('crazy-logs', undefined, { roundsToWin })!;
    const room = new Room('ABCD', cfg, sel);
    const ps = Array.from({ length: players }, (_, i) => new FakeClient(`p${i}`));
    ps.forEach((p) => room.join(asClient(p)));
    startMatch(room, ps);
    for (let i = 0; i < 60 * 3000 && room.phase !== 'finished'; i++) room.update(1 / 60);
    expect(room.phase).toBe('finished');
    return { room, ps };
  };
  const lastVote = (c: FakeClient) => c.of('VOTE_UPDATE').at(-1)!;

  it('ends the match only when a player has the chosen number of round wins', () => {
    const { ps } = finished(2);
    const starts = ps[0].of('GAME_START');
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.every((s) => s.roundsToWin === 2 && s.total === 1)).toBe(true);
    expect(starts.map((s) => s.round)).toEqual(starts.map((_, i) => i + 1));
    const final = ps[0].of('MATCH_FINISHED').at(-1)!;
    expect(final.ranking[0]!.wins).toBeGreaterThanOrEqual(2);
    expect(ps[0].of('GAME_RESULT').at(-1)!.last).toBe(true);
    expect(ps[0].of('GAME_RESULT')[0]!.last).toBe(starts.length === 1);
    // the recap: every round's placements, and an MVP who won the most rounds
    expect(final.rounds).toHaveLength(starts.length);
    expect(final.rounds![0]!.placements.map((p) => p.id).sort()).toEqual(final.ranking.map((r) => r.id).sort());
    const wins = (id: string) => final.rounds!.filter((r) => r.placements.some((p) => p.id === id && p.place === 1)).length;
    if (final.mvp) expect(Math.max(...final.ranking.map((r) => wins(r.id)))).toBe(wins(final.mvp));
  });

  it('a playlist runs each entry to its own wins, falling back to the playlist default', () => {
    const sel = normalizeSelection(
      undefined,
      undefined,
      undefined,
      [{ game: 'crazy-logs', options: { roundsToWin: 1 } }, { game: 'crazy-logs' }],
      1,
    )!;
    const room = new Room('ABCD', cfg, sel);
    const ps = [new FakeClient('p0'), new FakeClient('p1')];
    ps.forEach((p) => room.join(asClient(p)));
    startMatch(room, ps);
    for (let i = 0; i < 60 * 3000 && room.phase !== 'finished'; i++) room.update(1 / 60);
    expect(room.phase).toBe('finished');
    const starts = ps[0].of('GAME_START');
    expect(starts.map((s) => [s.index, s.roundsToWin])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('only the host can ask, and only after the match', () => {
    const { room, ps } = finished(1);
    room.startVote('p1', 'again');
    expect(ps[1].of('ERROR').at(-1)!.code).toBe('NOT_HOST');
    const s = setup(2);
    s.room.startVote('p0', 'again');
    expect(s.ps[0].of('ERROR').at(-1)!.code).toBe('BAD_STATE');
  });

  it('play again needs a majority, then starts a fresh match', () => {
    const { room, ps } = finished(1);
    room.startVote('p0', 'again');
    expect(lastVote(ps[1]).vote).toMatchObject({ kind: 'again', needed: 2 });
    expect(room.phase).toBe('finished');
    const before = ps[0].of('GAME_START').length;
    room.castVote('p1', true);
    expect(lastVote(ps[0])).toMatchObject({ outcome: 'passed', kind: 'again' });
    expect(room.phase).toBe('countdown');
    expect(ps[0].of('GAME_START')).toHaveLength(before + 1);
    expect(ps[0].of('GAME_START').at(-1)!.round).toBe(1);
    expect(ps[0].of('ROOM_UPDATE').at(-1)!.players.every((p) => p.score === 0 && p.wins === 0)).toBe(true);
  });

  it('change game returns everyone to the lobby once approved; a no keeps the end screen', () => {
    const a = finished(1);
    a.room.startVote('p0', 'change');
    a.room.castVote('p1', false);
    expect(lastVote(a.ps[0])).toMatchObject({ outcome: 'failed', kind: 'change' });
    expect(a.room.phase).toBe('finished');

    const b = finished(1);
    b.room.startVote('p0', 'change');
    b.room.castVote('p1', true);
    expect(b.room.phase).toBe('lobby');
    expect(b.ps[0].of('ROOM_UPDATE').at(-1)!.players.every((p) => !p.ready && p.score === 0)).toBe(true);
  });
});

describe('teams', () => {
  const teamRoom = (n = 4, game = 'crazy-logs', variant?: string) => {
    const sel = normalizeSelection(game, variant, {})!;
    const room = new Room('ABCD', { ...cfg, maxPlayersPerRoom: 8 }, sel);
    const ps = Array.from({ length: n }, (_, i) => new FakeClient(`p${i}`));
    ps.forEach((p) => expect(room.join(asClient(p)).ok).toBe(true));
    return { room, ps };
  };
  const lastUpdate = (c: FakeClient) => c.of('ROOM_UPDATE').at(-1)!;

  it('are off by default and balance everyone when the host turns them on', () => {
    const { room, ps } = teamRoom(4);
    expect(lastUpdate(ps[0]).teams).toBe(false);
    expect(lastUpdate(ps[0]).players.every((p) => p.team === undefined)).toBe(true);
    room.setSettings('p0', { teams: true });
    const u = lastUpdate(ps[0]);
    expect(u.teams).toBe(true);
    expect(u.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
  });

  it('only the host switches them, and a game without team support refuses', () => {
    const { room, ps } = teamRoom(2);
    room.setSettings('p1', { teams: true });
    expect(lastUpdate(ps[0]).teams).toBe(false);
    const sel = normalizeSelection(undefined, undefined, undefined, [{ game: 'crazy-logs' }])!;
    room.setSelection('p0', sel);
    room.setSettings('p0', { teams: true });
    expect(lastUpdate(ps[0]).teams).toBe(true);
  });

  it('respects the team size and lets players and the host move people', () => {
    const { room, ps } = teamRoom(4, 'ballistix', 'smashball'); // maxTeamSize 2
    room.setSettings('p0', { teams: true });
    expect(lastUpdate(ps[0]).teamSize).toBe(2);
    room.setTeam('p1', 0); // team 0 already has p0 and p2
    expect(ps[1].of('ERROR').at(-1)!.code).toBe('BAD_STATE');
    room.setTeam('p1', 2);
    expect(lastUpdate(ps[0]).players.find((p) => p.id === 'p1')!.team).toBe(2);
    room.setTeam('p2', 1, 'p3'); // not the host
    expect(lastUpdate(ps[0]).players.find((p) => p.id === 'p3')!.team).toBe(1);
    room.setTeam('p0', 2, 'p3');
    expect(lastUpdate(ps[0]).players.find((p) => p.id === 'p3')!.team).toBe(2);
  });

  it('will not start with a single team', () => {
    const { room, ps } = teamRoom(2);
    room.setSettings('p0', { teams: true });
    room.setTeam('p1', 0);
    ps[1].msgs.length = 0;
    room.setReady('p1', true);
    room.startMatch('p0');
    expect(ps[0].of('ERROR').at(-1)!.code).toBe('BAD_STATE');
    expect(room.phase).toBe('lobby');
  });

  it('give every member of the best team the round win and report team standings', () => {
    const { room, ps } = teamRoom(4, 'ballistix', 'smashball'); // idle players must not tie
    room.setSettings('p0', { teams: true });
    ps.slice(1).forEach((p) => room.setReady(p.id, true));
    room.startMatch('p0');
    for (let i = 0; i < 60 * 900 && room.phase !== 'results'; i++) room.update(1 / 60);
    expect(room.phase).toBe('results');
    const res = ps[0].of('GAME_RESULT').at(-1)!;
    expect(res.teams).toHaveLength(2);
    expect(res.teams![0]!.place).toBe(1);
    expect(res.placements.every((p) => p.team !== undefined)).toBe(true);
    const winning = res.teams![0]!.team;
    const wins = lastUpdate(ps[0]).players.map((p) => ({ team: p.team, wins: p.wins }));
    for (const w of wins) expect(w.wins).toBe(w.team === winning ? 1 : 0);
  });
});

describe('emotes', () => {
  it('are relayed to players and spectators, and rate limited per sender', () => {
    const { room, ps } = setup(2);
    const w = new FakeClient('w0', 'Watcher');
    expect(room.joinSpectator(asClient(w)).ok).toBe(true);
    room.emote('p0', 2);
    room.emote('w0', 4);
    expect(w.of('EMOTE')).toEqual([
      { t: 'EMOTE', from: 'p0', name: 'p0', emote: 2 },
      { t: 'EMOTE', from: 'w0', name: 'Watcher', emote: 4 },
    ]);
    expect(ps[1].of('EMOTE')).toHaveLength(2);
    for (let i = 0; i < 10; i++) room.emote('p0', 1);
    expect(ps[1].of('EMOTE').filter((e) => e.from === 'p0')).toHaveLength(3);
  });

  it('ignores unknown senders', () => {
    const { room, ps } = setup(1);
    room.emote('ghost', 0);
    expect(ps[0].of('EMOTE')).toHaveLength(0);
  });
});

describe('reports', () => {
  it('reaches the operator hook once per pair, rate limited, and never the room', () => {
    const got: { target: string; reporter: string }[] = [];
    const room = new Room('ABCD', { ...cfg, maxPlayersPerRoom: 8 }, { ...DEFAULT_SELECTION, game: 'crazy-logs' }, {
      reported: (r) => got.push({ target: r.target, reporter: r.reporter }),
    });
    const ps = ['a', 'b', 'c', 'd', 'e'].map((n) => new FakeClient(n, n.toUpperCase()));
    ps.forEach((p) => room.join(asClient(p)));
    room.report('a', 'b');
    room.report('a', 'b'); // same pair again
    room.report('a', 'a'); // self
    room.report('a', 'ghost');
    expect(got).toEqual([{ target: 'B', reporter: 'A' }]);
    room.report('a', 'c');
    room.report('a', 'd');
    room.report('a', 'e'); // 4th within a minute
    expect(got).toHaveLength(3);
    expect(ps[1].of('ERROR')).toHaveLength(0);
  });
});

describe('report memory', () => {
  it('forgets the oldest pairs, so a room with many joiners stays bounded', () => {
    vi.useFakeTimers();
    try {
      const room = new Room('ABCD', { ...cfg, maxPlayersPerRoom: 8 }, { ...DEFAULT_SELECTION, game: 'crazy-logs' }, { reported: () => {} });
      room.join(asClient(new FakeClient('host', 'Host')));
      for (let i = 0; i < 300; i++) {
        const p = new FakeClient(`p${i}`, `P${i}`);
        room.join(asClient(p));
        vi.advanceTimersByTime(61_000); // the per-reporter limit is 3 a minute
        room.report(`p${i}`, 'host');
        room.leave(`p${i}`, undefined, true);
      }
      expect((room as unknown as { reportedPairs: Set<string> }).reportedPairs.size).toBe(128);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a server with no games installed', () => {
  it('lets players gather but refuses to start a match', () => {
    const saved = [...CATALOG];
    unregisterGames(saved.map((g) => g.id));
    try {
      const { room, ps } = setup(2);
      startMatch(room, ps);
      expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'NO_GAMES' });
      expect(ps[0].of('GAME_START')).toHaveLength(0);
    } finally {
      registerGames(saved);
    }
  });
});

describe('virtual players (plugins)', () => {
  const vcfg: ServerConfig = { ...cfg, maxPlayersPerRoom: 4 };
  function vroom(humans = 1) {
    const room = new Room('ABCD', vcfg, { ...DEFAULT_SELECTION, game: 'crazy-logs' });
    const ps = Array.from({ length: humans }, (_, i) => new FakeClient(`p${i}`));
    ps.forEach((p) => expect(room.join(asClient(p)).ok).toBe(true));
    return { room, ps };
  }
  const seatV = (room: Room, id: string, extra: { yields?: boolean; seat?: string; ext?: unknown } = {}) => room.joinVirtual(asClient(new FakeClient(id)), { plugin: 'bots', ...extra });

  it('seats a virtual player that shows as virtual and is not a person', () => {
    const { room, ps } = vroom(1);
    expect(seatV(room, 'v1', { ext: { level: 'hard' } }).ok).toBe(true);
    const info = ps[0].of('ROOM_UPDATE').at(-1)!.players.find((p) => p.id === 'v1')!;
    expect(info).toMatchObject({ virtual: true, ext: { bots: { level: 'hard' } } });
    expect(room.humans).toBe(1);
    expect(room.players).toBe(2);
  });

  it('keeps plugin state per room and only sends changes', () => {
    const { room, ps } = vroom(1);
    room.setExt('bots', { fill: true });
    expect(ps[0].of('ROOM_UPDATE').at(-1)!.ext).toEqual({ bots: { fill: true } });
    const before = ps[0].of('ROOM_UPDATE').length;
    room.setExt('bots', { fill: true });
    expect(ps[0].of('ROOM_UPDATE')).toHaveLength(before);
    room.setExt('bots', null);
    expect(ps[0].of('ROOM_UPDATE').at(-1)!.ext).toBeUndefined();
    expect(() => room.setExt('bots', 'x'.repeat(5000))).toThrow();
  });

  it('holds reserved seats against people and fills them once', () => {
    const { room } = vroom(1);
    const a = room.reserveSeat('bots')!;
    room.reserveSeat('bots');
    room.reserveSeat('bots');
    expect(room.reserveSeat('bots')).toBeNull();
    expect(room.freeSeats).toBe(0);
    expect(room.join(asClient(new FakeClient('late')))).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(seatV(room, 'v1', { seat: 'nope' })).toMatchObject({ ok: false });
    expect(seatV(room, 'v1', { seat: a }).ok).toBe(true);
    expect(room.reservedSeats('bots')).toHaveLength(2);
    expect(seatV(room, 'v2', { seat: a })).toMatchObject({ ok: false });
    expect(room.releaseSeat('bots', room.reservedSeats('bots')[0])).toBe(true);
    expect(room.join(asClient(new FakeClient('late'))).ok).toBe(true);
  });

  it('sends a yielding virtual player away when a person needs the seat, and not one that does not yield', () => {
    const { room } = vroom(1);
    for (const id of ['y1', 'y2']) expect(seatV(room, id, { yields: true }).ok).toBe(true);
    expect(seatV(room, 'stay').ok).toBe(true);
    expect(room.join(asClient(new FakeClient('p1'))).ok).toBe(true);
    expect(room.memberList().map((m) => m.id)).toEqual(['p0', 'y2', 'stay', 'p1']);
    expect(room.join(asClient(new FakeClient('p2'))).ok).toBe(true);
    expect(room.memberList().map((m) => m.id)).toEqual(['p0', 'stay', 'p1', 'p2']);
    expect(room.join(asClient(new FakeClient('p3')))).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('removes virtual players by plugin and filter, never a person', () => {
    const { room } = vroom(1);
    seatV(room, 'v1', { yields: true });
    seatV(room, 'v2');
    expect(room.removeVirtual('p0')).toBe(false);
    expect(room.removeVirtuals('bots', (m) => m.id === 'v1')).toBe(1);
    expect(room.removeVirtuals('other')).toBe(0);
    expect(room.removeVirtuals('bots')).toBe(1);
    expect(room.memberList().map((m) => m.id)).toEqual(['p0']);
  });

  it('is never the host, does not keep the room alive and bypasses a lock', () => {
    const { room, ps } = vroom(2);
    room.setSettings('p0', { locked: true });
    expect(seatV(room, 'v1').ok).toBe(true);
    room.leave('p0', undefined, true);
    expect(ps[1].of('ROOM_UPDATE').at(-1)!.hostId).toBe('p1');
    room.leave('p1', undefined, true);
    expect(room.humans).toBe(0);
    expect(room.players).toBe(1);
  });

  it('only joins in the lobby', () => {
    const { room, ps } = vroom(2);
    startMatch(room, ps);
    expect(seatV(room, 'v1')).toMatchObject({ ok: false, code: 'ROOM_BUSY' });
    expect(room.reserveSeat('bots')).toBeNull();
  });
});

describe('host forces the lobby', () => {
  it('sends everyone back from a running round, cancels a vote and records nothing', () => {
    const { room, ps } = setup(3);
    startMatch(room, ps);
    run(room, 4.5);
    expect(room.phase).not.toBe('lobby');
    room.startVote('p1', 'round');
    room.forceLobby('p1'); // not the host
    expect(ps[1].of('ERROR').pop()).toMatchObject({ code: 'NOT_HOST' });
    expect(room.phase).not.toBe('lobby');

    room.forceLobby('p0');
    expect(room.phase).toBe('lobby');
    for (const p of ps) {
      expect(p.of('NOTICE').pop()).toMatchObject({ code: 'BACK_TO_LOBBY' });
      expect(p.of('VOTE_UPDATE').pop()).toMatchObject({ vote: null, outcome: 'cancelled' });
    }
    const upd = ps[0].of('ROOM_UPDATE').pop()!;
    expect(upd.phase).toBe('lobby');
    expect(upd.players.every((pl) => !pl.ready)).toBe(true);
    run(room, 1);
    expect(room.phase).toBe('lobby');
  });

  it('says so when already in the lobby', () => {
    const { room, ps } = setup(2);
    room.forceLobby('p0');
    expect(ps[0].of('ERROR').pop()).toMatchObject({ code: 'BAD_STATE' });
  });
});

describe('role swap', () => {
  it('a player gives up the seat and watches, then sits down again', () => {
    const { room, ps } = setup(2);
    expect(room.demote(ps[1].id)).toEqual({ ok: true });
    expect(room.size).toBe(1);
    expect(room.isSpectator(ps[1].id)).toBe(true);
    expect(ps[1].of('WELCOME').at(-1)).toMatchObject({ spectator: true });
    expect(ps[0].of('PLAYER_LEFT').at(-1)).toMatchObject({ id: ps[1].id });
    expect(room.promote(asClient(ps[1])).ok).toBe(true);
    expect(room.size).toBe(2);
    expect(ps[1].of('WELCOME').at(-1)).toMatchObject({ spectator: false });
  });

  it('is refused mid-match, for a non-player and when the spectator cap is reached', () => {
    const { room, ps } = setup(2);
    room.joinSpectator(asClient(new FakeClient('s1')));
    room.joinSpectator(asClient(new FakeClient('s2')));
    expect(room.demote(ps[1].id)).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(room.demote('nobody')).toMatchObject({ ok: false, code: 'BAD_STATE' });
    const g = setup(2);
    startMatch(g.room, g.ps);
    expect(g.room.demote(g.ps[1].id)).toMatchObject({ ok: false, code: 'ROOM_BUSY' });
  });

  it('a host who watches keeps the host powers, and sits down as an ordinary host', () => {
    const { room, ps } = setup(2);
    expect(room.demote(ps[0].id).ok).toBe(true);
    expect(room.hostId).toBe(ps[0].id);
    expect(room.isHost(ps[0].id)).toBe(true);
    room.setSettings(ps[0].id, { locked: true });
    expect(room.locked).toBe(true);
    room.kick(ps[0].id, ps[1].id);
    expect(room.size).toBe(0);
    expect(room.controllerConnected).toBe(true);
    expect(room.promote(asClient(ps[0])).ok).toBe(true);
    expect(room.controllerId).toBe('');
    expect(room.isHost(ps[0].id)).toBe(true);
  });

  it('the host moves another user both ways; others cannot', () => {
    const { room, ps } = setup(3);
    room.setRole(ps[1].id, ps[2].id, true);
    expect(ps[1].of('ERROR').at(-1)).toMatchObject({ code: 'NOT_HOST' });
    room.setRole(ps[0].id, ps[2].id, true);
    expect(room.isSpectator(ps[2].id)).toBe(true);
    room.setRole(ps[0].id, ps[2].id, false);
    expect(room.size).toBe(3);
    room.setRole(ps[0].id, 'ghost', true);
    expect(ps[0].of('ERROR').at(-1)).toMatchObject({ code: 'BAD_STATE' });
  });

  it('hands the host role on when a watching host leaves', () => {
    const { room, ps } = setup(2);
    room.demote(ps[0].id);
    room.leave(ps[0].id);
    expect(room.hostId).toBe(ps[1].id);
  });
});
