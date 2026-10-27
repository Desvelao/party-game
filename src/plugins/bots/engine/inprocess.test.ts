import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION } from '../../../core/shared';
import { loadConfig } from '../../../core/server/config';
import type { RoomClient } from '../../../core/server/networking/Client';
import { Room } from '../../../core/server/rooms/Room';
import { InProcessRunner } from './inprocess';
import type { BotSpec, RunnerHooks } from './types';

class Human implements RoomClient {
  profileId = null;
  looks = {};
  preferredColor = null;
  roomCode: string | null = null;
  ip = '';
  constructor(public id: string, public name = id) {}
  send() {}
  close() {}
}

const spec = (over: Partial<BotSpec> = {}): BotSpec => ({ name: 'Bot Easy', room: 'ABCD', url: '', plan: { gameId: 'ballistix', level: 'easy', policy: 'predictive', params: {} }, reports: { enabled: false, dir: '' }, seed: 1, ...over });
const hooks = (log: string[]): RunnerHooks => ({ onEvent: (e) => log.push(e.kind), onLog: () => {}, onExit: (err) => log.push(`exit:${err ?? ''}`) });
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('InProcessRunner', () => {
  const make = () => {
    const room = new Room('ABCD', { ...loadConfig({}, () => {}), maxPlayersPerRoom: 4 }, { ...DEFAULT_SELECTION, game: 'ballistix', variant: 'smashball' });
    room.join(new Human('p0'));
    return { room, runner: new InProcessRunner({ get: (c) => (c === 'ABCD' ? room : undefined) }, 'bots') };
  };

  it('seats a bot that gets ready by itself and leaves on stop', async () => {
    const { room, runner } = make();
    const log: string[] = [];
    const h = runner.start(spec(), hooks(log));
    await tick();
    const bot = room.memberList().find((m) => m.virtual)!;
    expect(bot).toMatchObject({ name: 'Bot Easy', plugin: 'bots', ext: { level: 'easy', added: false } });
    expect(log).toContain('joined');
    expect(runner.size).toBe(1);
    h.stop('test');
    expect(room.memberList().some((m) => m.virtual)).toBe(false);
    expect(log).toContain('exit:');
    expect(runner.size).toBe(0);
  });

  it('reports a room that is gone or a seat that does not exist', async () => {
    const { runner } = make();
    const gone: string[] = [];
    runner.start(spec({ room: 'ZZZZ' }), hooks(gone));
    const noSeat: string[] = [];
    runner.start(spec({ auth: { token: '', seat: 'nope' } }), hooks(noSeat));
    await tick();
    expect(gone).toEqual(['exit:room closed']);
    expect(noSeat.at(-1)).toMatch(/^exit:No such reserved seat/);
  });

  it('is sent away when a person takes its yielding seat', async () => {
    const { room, runner } = make();
    const log: string[] = [];
    for (let i = 0; i < 3; i++) runner.start(spec({ name: `Bot ${i}` }), i === 0 ? hooks(log) : hooks([]));
    await tick();
    expect(room.players).toBe(4);
    expect(room.join(new Human('p1')).ok).toBe(true);
    await tick();
    expect(room.humans).toBe(2);
    expect(room.players).toBe(4);
    expect(log.some((l) => l.startsWith('exit'))).toBe(true);
  });
});
