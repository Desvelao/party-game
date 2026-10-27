// Headless rounds for a game's AI (no server, no sockets): bots in every seat see what a phone would, i.e. snapshots
// every `snapEvery` ticks round-tripped through JSON, their private state when it changes, and the round's events.
// Each pack's bot/sim.ts builds its minigame and brains and calls this (tests, A/B runs, quick level checks).
import type { GameBrain } from '../ai';
import type { Minigame } from '../plugin-api';
import type { InputState } from '../types';

export interface BotSimResult {
  /** per seat: 1 = best */
  places: number[];
  seconds: number;
  /** why things went wrong, per seat: incident cause -> count */
  causes: Record<string, number>[];
  /** events by kind and seat (events carrying `id`): kind -> count per seat */
  events: Record<string, number[]>;
  /** each seat's brain metrics at the end of the round */
  metrics: Record<string, number>[];
  /** slowest decide() call, ms (the first calls include the JIT warming up) */
  maxDecideMs: number;
  /** mean and 99th percentile of the decide() calls, ms */
  avgDecideMs: number;
  p99DecideMs: number;
}

export interface BotSimOptions {
  tickRate?: number;
  /** a snapshot every this many ticks (the network rate) */
  snapEvery?: number;
  /** decisions every this many ms (the WebSocket client decides every 33 ms) */
  decideMs?: number;
  maxSeconds?: number;
  /** clock for the decide() timing (performance.now in the tests) */
  clock?: () => number;
}

/** Play `game` (already constructed, not initialised) with `brains[i]` in seat `ids[i]` until it ends. */
export function playBots(game: Minigame, ids: string[], brains: GameBrain[], o: BotSimOptions = {}): BotSimResult {
  const tickRate = o.tickRate ?? 60;
  const snapEvery = o.snapEvery ?? 3;
  const decideEvery = Math.max(1, Math.round(((o.decideMs ?? 33) * tickRate) / 1000));
  const clock = o.clock ?? (() => 0);
  game.init(ids.map((id) => ({ id, name: id })));
  const causes: Record<string, number>[] = brains.map(() => ({}));
  const events: Record<string, number[]> = {};
  const privSent = ids.map(() => '');
  const inputs: InputState[] = ids.map(() => ({ mx: 0, my: 0, a1: false, a2: false }));
  const max = Math.round((o.maxSeconds ?? 300) * tickRate);
  let maxDecideMs = 0;
  const times: number[] = [];
  let tick = 0;
  for (; tick < max && !game.isFinished(); tick++) {
    const nowMs = (tick * 1000) / tickRate;
    if (tick % snapEvery === 0) {
      const json = JSON.stringify(game.getState());
      for (const b of brains) b.onState(JSON.parse(json), { tick, phase: 'playing', recvMs: nowMs });
      if (game.getPrivateState) {
        ids.forEach((id, i) => {
          const pj = JSON.stringify(game.getPrivateState!(id) ?? null);
          if (pj === privSent[i]) return;
          privSent[i] = pj;
          brains[i].onPrivate?.(JSON.parse(pj));
        });
      }
    }
    if (tick % decideEvery === 0) {
      brains.forEach((b, i) => {
        const t0 = clock();
        const raw = b.decide(nowMs);
        const ms = clock() - t0;
        maxDecideMs = Math.max(maxDecideMs, ms);
        times.push(ms);
        // what the host sends: sticks rounded to 0.01
        inputs[i] = { mx: Math.round(raw.mx * 100) / 100, my: Math.round(raw.my * 100) / 100, a1: raw.a1, a2: raw.a2 };
        game.handleInput(ids[i], inputs[i]);
      });
    }
    game.update(1 / tickRate);
    const evs = game.drainEvents();
    if (evs.length) {
      for (const ev of evs) {
        const seat = ids.indexOf((ev as { id?: string }).id ?? '');
        if (seat >= 0) (events[ev.kind] ??= ids.map(() => 0))[seat]++;
      }
      brains.forEach((b, i) => {
        for (const inc of b.onEvents(evs)) causes[i][inc.cause] = (causes[i][inc.cause] ?? 0) + 1;
      });
    }
  }
  const place = new Map(game.getPlacements().map((p) => [p.id, p.place]));
  times.sort((a, b) => a - b);
  const avgDecideMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const p99DecideMs = times.length ? times[Math.floor(times.length * 0.99)] : 0;
  return { places: ids.map((id) => place.get(id) ?? 99), seconds: tick / tickRate, causes, events, metrics: brains.map((b) => b.metrics()), maxDecideMs, avgDecideMs, p99DecideMs };
}
