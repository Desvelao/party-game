import { describe, expect, it } from 'vitest';
import { ballistix } from '../../../games/ballistix/bot';
import { BotManager } from './manager';
import { AiRouter, type RoomSelection } from './router';
import { registerGame } from './registry';
import type { BotRunner, EngineConfig, RunnerHooks } from './types';
import { RoomWatcher, type RoomSummary, type WatcherDeps } from './watcher';

const DEFAULTS: EngineConfig = {
  gameServer: { url: 'http://game:8080', botToken: '' },
  join: { pollSeconds: 3, botsPerRoom: 1, maxBots: 8, minHumans: 1, cooldownSeconds: 30, recheckSeconds: 60 },
  ai: { level: 'normal', mixed: 'never', playlistJoin: 'any', idleLeaveSeconds: 120, namePrefix: 'Bot' },
  reports: { enabled: false, dir: '' },
};

class FakeRunner implements BotRunner {
  hooks: RunnerHooks[] = [];
  plans: { level: string; room: string }[] = [];
  start(spec: { room: string; plan: { level: string } }, hooks: RunnerHooks) {
    this.hooks.push(hooks);
    this.plans.push({ level: spec.plan.level, room: spec.room });
    return {
      stop: (reason: string) => {
        hooks.onEvent({ kind: 'closed', reason });
        hooks.onExit();
      },
      usage: () => ({ cpu: 0, heapMB: 0, externalMB: 0 }),
    };
  }
}

const room = (over: Partial<RoomSummary> = {}): RoomSummary => ({ code: 'AAAA', game: 'x', phase: 'lobby', status: 'open', players: 1, maxPlayers: 4, spectators: 0, locked: false, passwordProtected: false, ...over });

function setup(rooms: RoomSummary[], selection: RoomSelection = { game: 'ballistix' }) {
  registerGame(ballistix);
  const cfg: EngineConfig = structuredClone(DEFAULTS);
  const runner = new FakeRunner();
  const clock = { t: 1_000_000 };
  const bots = new BotManager(runner, cfg, () => clock.t);
  const probes: string[] = [];
  const state = { rooms, selection };
  const deps: WatcherDeps = {
    fetchRooms: async () => state.rooms,
    probe: async (_url, code) => {
      probes.push(code);
      return { ok: true, selection: state.selection, maxPlayers: 4 };
    },
    now: () => clock.t,
  };
  const w = new RoomWatcher(cfg, new AiRouter(cfg.ai), bots, deps);
  return { cfg, runner, bots, w, clock, probes, state };
}

describe('automatic joining', () => {
  it('joins an open lobby that has a human and an AI, once', async () => {
    const { w, bots, runner } = setup([room()]);
    await w.poll();
    expect(w.views[0]).toMatchObject({ decision: 'joining', humans: 1 });
    expect(bots.count()).toBe(1);
    expect(runner.plans[0]).toEqual({ level: 'normal', room: 'AAAA' });
    await w.poll();
    expect(w.views[0].decision).toBe('bot-present');
    expect(bots.count()).toBe(1);
  });

  it('skips empty rooms, rooms without an AI, started matches and full rooms', async () => {
    const { w, bots } = setup([room({ code: 'E000', players: 0 }), room({ code: 'P000', status: 'playing', phase: 'playing' }), room({ code: 'F000', players: 4 }), room({ code: 'L000', locked: true })]);
    await w.poll();
    expect(Object.fromEntries(w.views.map((v) => [v.code, v.decision]))).toEqual({ E000: 'no-human', P000: 'not-open', F000: 'full', L000: 'protected' });
    expect(bots.count()).toBe(0);
    const other = setup([room()], { game: 'frost-shove' });
    await other.w.poll();
    expect(other.w.views[0]).toMatchObject({ decision: 'no-ai', detail: 'no AI for frost-shove' });
  });

  it('stops at the bot limit and leaves when the humans do', async () => {
    const { w, bots, cfg, state, runner } = setup([room({ code: 'A000' }), room({ code: 'B000' })]);
    cfg.join.maxBots = 1;
    await w.poll();
    expect(w.views.map((v) => v.decision)).toEqual(['joining', 'bot-limit']);
    runner.hooks[0].onEvent({ kind: 'joined', room: 'A000', id: 'x' });
    state.rooms = [room({ code: 'A000', players: 1 })]; // only the bot is left (players counts it)
    await w.poll();
    expect(bots.count()).toBe(0);
  });

  it('a playlist is joined when any game is known, unless playlistJoin is all', async () => {
    const list: RoomSelection = { game: 'custom', playlist: [{ game: 'ballistix' }, { game: 'tank-wars' }] };
    const a = setup([room()], list);
    await a.w.poll();
    expect(a.w.views[0].decision).toBe('joining');
    const b = setup([room()], list);
    b.cfg.ai.playlistJoin = 'all';
    await b.w.poll();
    expect(b.w.views[0]).toMatchObject({ decision: 'no-ai', detail: 'no AI for tank-wars' });
  });
});

describe('adding and removing bots by hand', () => {
  it('adds a bot with the chosen level, even to a room without humans', async () => {
    const { w, bots, runner } = setup([room({ players: 0 })]);
    await w.poll();
    expect(w.views[0].decision).toBe('no-human');
    expect(await w.addBot('aaaa', 'hard')).toMatchObject({ ok: true });
    expect(bots.count()).toBe(1);
    expect(runner.plans[0].level).toBe('hard');
  });

  it('a bot added by hand stays in a room without humans; one that came on its own leaves', async () => {
    const { w, bots, runner } = setup([room({ players: 0 })]);
    await w.poll();
    await w.addBot('AAAA');
    runner.hooks[0].onEvent({ kind: 'joined', room: 'AAAA', id: 'x' });
    const auto = setup([room()]);
    await auto.w.poll();
    auto.runner.hooks[0].onEvent({ kind: 'joined', room: 'AAAA', id: 'x' });
    auto.state.rooms = [room({ players: 1 })]; // the human went, the bot is all that is left
    await w.poll();
    await auto.w.poll();
    expect(bots.count()).toBe(1);
    expect(auto.bots.count()).toBe(0);
  });

  it('refuses with a reason when the room cannot take a bot', async () => {
    const { w, cfg, state } = setup([room({ code: 'F000', players: 4 }), room({ code: 'P000', status: 'playing' }), room({ code: 'L000', passwordProtected: true }), room({ code: 'O000' })]);
    await w.poll();
    expect(await w.addBot('F000')).toEqual({ ok: false, error: 'the room is full' });
    expect(await w.addBot('P000')).toMatchObject({ ok: false, error: expect.stringContaining('lobby') });
    expect(await w.addBot('L000')).toMatchObject({ ok: false, error: expect.stringContaining('password') });
    expect(await w.addBot('ZZZZ')).toMatchObject({ ok: false, error: expect.stringContaining('no such room') });
    cfg.join.maxBots = 0;
    expect(await w.addBot('O000')).toEqual({ ok: false, error: 'the bot limit (0) is reached' });
    cfg.join.maxBots = 5;
    state.selection = { game: 'frost-shove' };
    state.rooms[3].game = 'changed'; // the host picked another game: the label changes, so the room is read again
    await w.poll();
    expect(await w.addBot('O000')).toEqual({ ok: false, error: 'no AI for frost-shove' });
  });

  it('removes the bots of a room and leaves it alone for a while', async () => {
    const { w, bots, cfg, clock } = setup([room()]);
    await w.poll();
    expect(w.removeBots('AAAA')).toBe(1);
    expect(bots.count()).toBe(0);
    expect(w.removeBots('AAAA')).toBe(0);
    await w.poll();
    expect(w.views[0].decision).toBe('cooldown');
    clock.t += (cfg.join.cooldownSeconds + 1) * 1000;
    await w.poll();
    expect(w.views[0].decision).toBe('joining');
  });
});

describe('idle bots', () => {
  it('stay idle while the room reports other phases (a room update does not wake them)', async () => {
    const { w, bots, runner, clock, cfg } = setup([room({ players: 2 })]);
    cfg.ai.idleLeaveSeconds = 20;
    await w.poll();
    runner.hooks[0].onEvent({ kind: 'idle', on: true, game: 'ext:tank-wars' });
    runner.hooks[0].onEvent({ kind: 'lobby', phase: 'playing', players: 2, game: 'custom', variant: 'all', playlist: ['ballistix', 'tank-wars'] });
    expect(bots.active()[0].state).toBe('idle');
    clock.t += 21_000;
    await w.poll();
    expect(bots.count()).toBe(0);
  });

  it('leave after ai.idleLeaveSeconds without a game they can play', async () => {
    const { w, bots, runner, clock, cfg, state } = setup([room({ players: 2 })]);
    cfg.ai.idleLeaveSeconds = 60;
    await w.poll();
    runner.hooks[0].onEvent({ kind: 'joined', room: 'AAAA', id: 'x' });
    // the playlist moves on to a round of a game it has no AI for
    runner.hooks[0].onEvent({ kind: 'idle', on: true, game: 'ext:tank-wars' });
    expect(bots.active()[0].state).toBe('idle');
    clock.t += 30_000;
    await w.poll();
    expect(bots.count()).toBe(1);
    clock.t += 31_000;
    await w.poll();
    expect(bots.count()).toBe(0);
    expect(bots.list()[0].endReason).toBe('idle');
    // it does not come straight back to the same playlist...
    clock.t += 3_600_000;
    await w.poll();
    expect(bots.count()).toBe(0);
    expect(w.views[0]).toMatchObject({ decision: 'no-ai', detail: expect.stringContaining('idle') });
    // ...but tries again when the room is set to something else
    state.rooms = [room({ players: 2, game: 'another' })];
    await w.poll();
    expect(bots.count()).toBe(1);
  });

  it('start over when the bot gets a game it knows again', async () => {
    const { w, bots, runner, clock, cfg } = setup([room({ players: 2 })]);
    cfg.ai.idleLeaveSeconds = 60;
    await w.poll();
    runner.hooks[0].onEvent({ kind: 'idle', on: true, game: 'ext:tank-wars' });
    clock.t += 50_000;
    runner.hooks[0].onEvent({ kind: 'idle', on: false, game: 'ext:ballistix' });
    expect(bots.active()[0]).toMatchObject({ state: 'playing', idleSince: null });
    clock.t += 50_000;
    await w.poll();
    expect(bots.count()).toBe(1);
  });

  it('a lobby switched to a game without an AI counts as idle, and 0 means never leave', async () => {
    const { w, bots, runner, clock, cfg } = setup([room({ players: 2 })]);
    cfg.ai.idleLeaveSeconds = 30;
    await w.poll();
    runner.hooks[0].onEvent({ kind: 'lobby', phase: 'lobby', players: 2, game: 'frost-shove', variant: 'all', playlist: [] });
    await w.poll();
    expect(bots.active()[0].noAiSince).not.toBeNull();
    runner.hooks[0].onEvent({ kind: 'lobby', phase: 'lobby', players: 2, game: 'ballistix', variant: 'smashball', playlist: [] });
    await w.poll();
    expect(bots.active()[0].noAiSince).toBeNull();
    runner.hooks[0].onEvent({ kind: 'lobby', phase: 'lobby', players: 2, game: 'frost-shove', variant: 'all', playlist: [] });
    cfg.ai.idleLeaveSeconds = 0;
    await w.poll();
    clock.t += 3_600_000;
    await w.poll();
    expect(bots.count()).toBe(1);
  });
});

describe('rooms where the host asked for bots', () => {
  const hosted = (over: Partial<RoomSummary> & { botFill?: boolean; botLevel?: string; botSeats?: { id: string; level: string }[]; bots?: number } = {}) => {
    const { botFill = true, botLevel = 'hard', botSeats = [], bots: _b, ...rest } = over;
    return room({ phase: 'lobby', humans: 1, ext: { bots: { fill: botFill, level: botLevel, seats: botSeats } }, ...rest });
  };

  it('fills the free seats at the room level, and only once', async () => {
    const { w, bots, runner } = setup([hosted()]);
    await w.poll();
    expect(bots.count()).toBe(3);
    expect(runner.plans.map((p) => p.level)).toEqual(['hard', 'hard', 'hard']);
    await w.poll();
    expect(bots.count()).toBe(3); // the joining ones already count
  });

  it('starts nothing while filling is off and there are no reserved seats: the automatic join does not apply', async () => {
    const { w, bots } = setup([hosted({ botFill: false })]);
    await w.poll();
    expect(bots.count()).toBe(0);
    const plain = setup([room()]);
    await plain.w.poll();
    expect(plain.bots.count()).toBe(1); // a game server without bot settings keeps the automatic join
  });

  it('fills one bot per reserved seat at the seat level, with its id', async () => {
    const { w, bots, runner } = setup([hosted({ botFill: false, botSeats: [{ id: 's1', level: 'easy' }, { id: 's2', level: 'expert' }] })]);
    await w.poll();
    expect(bots.count()).toBe(2);
    expect(runner.plans.map((p) => p.level)).toEqual(['easy', 'expert']);
    expect(bots.active().map((b) => b.seat)).toEqual(['s1', 's2']);
    await w.poll();
    expect(bots.count()).toBe(2);
  });

  it('leaves room for humans: free seats already taken by players or reserved are not filled', async () => {
    const { w, bots } = setup([hosted({ players: 2, humans: 2, botSeats: [{ id: 's1', level: 'easy' }] })]);
    await w.poll();
    expect(bots.active().filter((b) => !b.seat)).toHaveLength(1); // 4 seats - 2 players - 1 reserved
    expect(bots.active().filter((b) => b.seat)).toHaveLength(1);
  });

  it('replaces fill bots when the room level changes', async () => {
    const { w, bots, state, runner } = setup([hosted({ maxPlayers: 2 })]);
    await w.poll();
    runner.hooks[0].onEvent({ kind: 'joined', room: 'AAAA', id: 'x' });
    state.rooms = [hosted({ maxPlayers: 2, players: 2, bots: 1, botLevel: 'easy' })];
    await w.poll();
    expect(bots.count()).toBe(0);
    state.rooms = [hosted({ maxPlayers: 2, players: 1, botLevel: 'easy' })];
    w.coolOff('AAAA');
    w['cooldown'].clear();
    await w.poll();
    expect(runner.plans.at(-1)!.level).toBe('easy');
  });

  it('removes the hosted bots when the last human is gone', async () => {
    const { w, bots, state, runner } = setup([hosted()]);
    await w.poll();
    runner.hooks.forEach((h) => h.onEvent({ kind: 'joined', room: 'AAAA', id: 'x' }));
    state.rooms = [hosted({ humans: 0, players: 3, bots: 3 })];
    await w.poll();
    expect(bots.count()).toBe(0);
  });

  it('does not join a room that already started', async () => {
    const { w, bots } = setup([hosted({ status: 'playing', phase: 'playing' })]);
    await w.poll();
    expect(bots.count()).toBe(0);
  });
});
