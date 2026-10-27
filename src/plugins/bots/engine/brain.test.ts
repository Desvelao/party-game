import { describe, expect, it } from 'vitest';
import type { AiContext, GameAi, GameBrain } from '../../../core/shared/ai';
import type { ClientMessage, ServerMessage } from '../../../core/shared';
import { BotBrain } from './brain';
import { registerGame } from './registry';

/** A dummy AI that records what the brain hands it and pushes the stick up. */
const seen: { ctx?: AiContext; priv: unknown[] } = { priv: [] };
const probe: GameAi = {
  id: 'probe',
  kind: 'ext:probe',
  policies: ['p'],
  defaultPolicy: 'p',
  defaultParams: {},
  create(ctx): GameBrain {
    seen.ctx = ctx;
    return {
      policy: 'p',
      onState() {},
      onEvents: () => [],
      onPrivate: (d) => void seen.priv.push(d),
      decide: () => ({ mx: 0.5, my: -1, a1: false, a2: false }),
      trace: () => null,
      metrics: () => ({}),
    };
  },
};
registerGame(probe);

function setup(team?: number) {
  const sent: ClientMessage[] = [];
  const b = new BotBrain(
    { name: 'b', minPlayers: 9, startDelayMs: 0, resultsDelayMs: 0, matches: 0, params: {}, seed: 1, log: () => {} },
    { send: (m) => sent.push(m), after: () => () => {}, stop: () => {}, now: () => 0 },
  );
  const m = (x: unknown) => b.handle(x as ServerMessage);
  m({ t: 'WELCOME', id: 'me', code: 'ABCD', config: { tickRate: 60, networkRate: 20 }, selection: { game: 'probe' } });
  const players = [
    { id: 'me', name: 'b', ready: true, connected: true, team },
    { id: 'mate', name: 'm', ready: true, connected: true, team },
    { id: 'foe', name: 'f', ready: true, connected: true, team: team === undefined ? undefined : team + 1 },
  ];
  m({ t: 'ROOM_UPDATE', phase: 'playing', hostId: 'foe', players, selection: { game: 'probe' } });
  m({ t: 'GAME_START', game: { id: 'probe', name: 'Probe' }, round: 1 });
  return { b, m, sent };
}

describe('BotBrain', () => {
  it('sends the vertical stick and replays private state that came before the first snapshot', () => {
    seen.priv = [];
    const { b, m, sent } = setup();
    m({ t: 'GAME_PRIVATE', data: { hand: [1, 2] } });
    m({ t: 'GAME_STATE', tick: 1, phase: 'playing', state: { kind: 'ext:probe' } });
    m({ t: 'GAME_PRIVATE', data: { hand: [2] } });
    expect(seen.priv).toEqual([{ hand: [1, 2] }, { hand: [2] }]);
    b.tick();
    expect(sent.at(-1)).toMatchObject({ t: 'INPUT', mx: 0.5, my: -1 });
    expect(seen.ctx?.allies).toEqual([]);
  });

  it('tells the AI who its teammates are', () => {
    const { m } = setup(0);
    m({ t: 'GAME_STATE', tick: 1, phase: 'playing', state: { kind: 'ext:probe' } });
    expect(seen.ctx?.allies).toEqual(['mate']);
  });
});
