// Offline rooms for bot:arena (--offline): the scenario's bots play the headless game simulation, no server, no sockets,
// as fast as the CPU allows. Each bot is the real BotBrain fed the messages a room would send: snapshots every
// round(tickRate / networkRate) ticks, JSON round-tripped like on the wire (so a bot sees positions only and tracks
// velocities itself), and decisions at the WebSocket client's 33 ms rate on a simulated clock. The seat order is
// shuffled every round, so no level keeps one spawn point. Each round starts with the room's countdown (the game does not run).
// Rooms are played one after another: the simulation is CPU-bound on one thread, so running them together would not be faster. Reports are the same match.json / events.jsonl /
// incidents/ that a live run writes, so bot:analyze reads them unchanged.
import { COUNTDOWN_SECONDS, placementPoints, selectionRounds, stagesOf, type ClientMessage, type GameSelection, type ServerMessage } from '../src/core/shared';
import { GRACE_SECONDS, limitOf } from '../src/core/tools/balance/runner';
import { makeGame } from '../src/core/tools/balance/factories';
import { mulberry32 } from '../src/core/shared/kit/util';
import { fullOptions } from '../src/core/tools/balance/sweep';
import type { Scenario } from './arena';
import { BotBrain } from './core/brain';
import { INPUT_MS } from './core/client';
import { DEFAULT_BOT_GAME } from './core/options';
import { Recorder } from './core/recorder';

export interface OfflineOptions {
  tickRate: number;
  networkRate: number;
  /** base seed; rooms, rounds and seats derive theirs from it */
  seed: number;
  log?: (line: string) => void;
}

/** Play `sc.matches` matches of one room offline; reports go to `dir/<room>-<seat>/`. Resolves once they are written. */
export async function runOfflineRoom(sc: Scenario, room: number, dir: string, names: string[], o: OfflineOptions): Promise<{ code: string; names: string[] }> {
  const code = `OFF${room}`;
  const { tickRate } = o;
  const netEvery = Math.max(1, Math.round(tickRate / o.networkRate));
  const decideEvery = Math.max(1, Math.round((tickRate * INPUT_MS) / 1000));
  const dt = 1 / tickRate;
  const selection: GameSelection = { game: sc.game ?? DEFAULT_BOT_GAME, variant: sc.variant ?? 'all', options: sc.options ?? {} };
  const rounds = selectionRounds(selection);
  if (!rounds.length) throw new Error(`room ${room}: nothing to play for ${selection.game}/${selection.variant}`);
  const target = stagesOf(selection)[0].roundsToWin;
  const ids = sc.seats.map((_, i) => `p${i}`);

  let tick = 0;
  let clockMs = 0;
  const now = () => clockMs;
  let game: ReturnType<typeof makeGame> | null = null;
  const recorders: Recorder[] = [];
  const brains = sc.seats.map((s, i) => {
    const send = (m: ClientMessage) => {
      if (m.t === 'INPUT' && game) game.handleInput(ids[i], { mx: m.mx, my: m.my, a1: m.a1, a2: m.a2 });
    };
    return new BotBrain(
      {
        name: names[i],
        minPlayers: sc.seats.length,
        startDelayMs: 0,
        resultsDelayMs: 0,
        matches: sc.matches ?? 1,
        policy: s.policy,
        params: s.params ?? {},
        seed: (o.seed * 7919 + room * 104729 + i * 31) >>> 0,
        level: s.bot,
        log: (line) => o.log?.(`room${room} ${names[i]}: ${line}`),
        makeRecorder: (w) => {
          const rec = new Recorder(
            dir,
            { url: 'offline', room: w.code, selfId: w.id, name: names[i], policy: '', level: s.bot ?? '', scenario: sc.name, seat: names[i], params: {}, seed: o.seed, serverConfig: w.config, selection: w.selection },
            { dirName: `${w.code}-${names[i]}`, now },
          );
          recorders.push(rec);
          return rec;
        },
      },
      // the offline loop drives the room itself: lobby requests (start, next game, rematch) and timers are not needed
      { send, after: () => () => {}, stop: () => {}, now },
    );
  });
  const all = (m: ServerMessage) => brains.forEach((b) => b.handle(m));

  brains.forEach((b, i) => b.handle({ t: 'WELCOME', id: ids[i], code, config: { tickRate, networkRate: tickRate / netEvery }, selection } as unknown as ServerMessage));
  const players = ids.map((id, i) => ({ id, name: names[i], ready: true, connected: true }));
  all({ t: 'ROOM_UPDATE', phase: 'playing', hostId: ids[0], players, selection, spectators: 0, watchers: [] } as unknown as ServerMessage);

  for (let match = 1; match <= Math.max(1, sc.matches ?? 1); match++) {
    const score = ids.map(() => 0);
    const wins = ids.map(() => 0);
    for (let round = 1; !wins.some((w) => w >= target); round++) {
      const entry = rounds[(round - 1) % rounds.length];
      const options = fullOptions(entry.id, entry.options);
      game = makeGame(entry.id, options, (o.seed * 7919 + room * 104729 + match * 1009 + round) >>> 0);
      // shuffle the seat order every round: in most games a seat means a spawn point (and in Tank Wars a cannon), and who
      // spawns next to whom matters, so a level kept in one seat (or one cyclic order) is measured with that seat's luck
      const order = ids.map((_, i) => i);
      const shuffle = mulberry32((o.seed * 7919 + room * 104729 + match * 1009 + round * 31 + 17) >>> 0);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(shuffle() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      game.init(order.map((k) => ({ id: ids[k], name: names[k] })));
      all({ t: 'GAME_START', game: { id: entry.id, name: entry.name }, index: round - 1, total: rounds.length, roundsToWin: target, round } as ServerMessage);
      const events: unknown[] = [];
      const privSent = ids.map(() => '');
      let countdown = COUNTDOWN_SECONDS;
      const broadcast = () => {
        all({ t: 'GAME_STATE', tick, phase: countdown > 0 ? 'countdown' : 'playing', countdown: Math.max(0, Math.round(countdown * 10) / 10), state: JSON.parse(JSON.stringify(game!.getState())) });
        // like the room: each seat's private state (a hand of cards), only when it changed
        if (game!.getPrivateState) {
          ids.forEach((id, i) => {
            const json = JSON.stringify(game!.getPrivateState!(id) ?? null);
            if (json === privSent[i]) return;
            privSent[i] = json;
            brains[i].handle({ t: 'GAME_PRIVATE', data: JSON.parse(json) });
          });
        }
        if (events.length) all({ t: 'GAME_EVENT', events: events.splice(0) } as ServerMessage);
      };
      broadcast();
      // like the room, the round starts with its countdown: the state is sent with phase 'countdown' and the game does not run
      while (countdown > 0) {
        countdown -= dt;
        clockMs += dt * 1000;
        if (++tick % netEvery === 0) broadcast();
      }
      countdown = 0;
      broadcast();
      const maxTicks = Math.ceil((limitOf(game.getState(), options) + GRACE_SECONDS) * tickRate);
      let t = 0;
      for (; t < maxTicks; t++) {
        if (t % decideEvery === 0) for (const b of brains) b.tick();
        game.update(dt);
        events.push(...game.drainEvents());
        clockMs += dt * 1000;
        if (game.isFinished()) break;
        if (++tick % netEvery === 0) broadcast();
      }
      if (!game.isFinished()) o.log?.(`room${room}: round ${round} did not finish in ${Math.round(t * dt)} s; scoring it as it stands`);
      broadcast();
      const placements = game
        .getPlacements()
        .map((p) => ({ id: p.id, name: names[ids.indexOf(p.id)] ?? '?', place: p.place, points: placementPoints(p.place) }))
        .sort((a, b) => a.place - b.place);
      for (const p of placements) {
        const k = ids.indexOf(p.id);
        score[k] += p.points;
        if (p.place === 1) wins[k]++;
      }
      all({ t: 'GAME_RESULT', game: { id: entry.id, name: entry.name }, placements, last: wins.some((w) => w >= target) });
      game = null;
    }
    const ranking = ids.map((id, i) => ({ id, name: names[i], score: score[i], wins: wins[i] })).sort((a, b) => b.wins - a.wins || b.score - a.score);
    all({ t: 'MATCH_FINISHED', ranking });
  }
  // the brains hold nothing else: closing their recorders ends them
  await Promise.all(recorders.map((r) => r.close()));
  return { code, names };
}
