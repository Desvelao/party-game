import { describe, expect, it } from 'vitest';
import type { GameBrain, Incident } from '../ai';
import type { Minigame } from '../plugin-api';
import type { InputState } from '../types';
import { playBots } from './botsim';

/** A one-counter game: each seat's `a1` input adds to its score each tick; the round ends at `goal` points. */
class CountGame implements Minigame {
  readonly id = 'count';
  readonly name = 'Count';
  private score = new Map<string, number>();
  private held = new Map<string, boolean>();
  private events: { kind: string; id?: string }[] = [];
  inputs: Record<string, InputState[]> = {};
  secret = 0;
  constructor(private readonly goal: number) {}
  init(players: { id: string }[]): void {
    for (const p of players) {
      this.score.set(p.id, 0);
      this.inputs[p.id] = [];
    }
  }
  handleInput(id: string, input: InputState): void {
    this.held.set(id, input.a1);
    this.inputs[id].push(input);
  }
  getPrivateState(id: string): unknown {
    return id === 'a' ? { secret: this.secret } : null;
  }
  removePlayer(): void {}
  update(): void {
    for (const [id, on] of this.held) if (on) this.score.set(id, this.score.get(id)! + 1);
    for (const [id, v] of this.score) if (v === this.goal) this.events.push({ kind: 'goal', id });
  }
  getState() {
    return { kind: 'count', score: Object.fromEntries(this.score) } as never;
  }
  drainEvents() {
    return this.events.splice(0) as never;
  }
  isFinished(): boolean {
    return [...this.score.values()].some((v) => v >= this.goal);
  }
  getPlacements() {
    const sorted = [...this.score].sort((a, b) => b[1] - a[1]);
    return sorted.map(([id], i) => ({ id, place: i + 1 }));
  }
}

class Brain implements GameBrain {
  readonly policy = 'test';
  states: { tick: number; recvMs: number; score: Record<string, number> }[] = [];
  privates: unknown[] = [];
  incidents = 0;
  constructor(private readonly press: boolean, private readonly id = '', private readonly mx = 0.123456) {}
  onState(state: { score: Record<string, number> }, meta: { tick: number; recvMs: number }): void {
    this.states.push({ tick: meta.tick, recvMs: meta.recvMs, score: state.score });
  }
  onPrivate(data: unknown): void {
    this.privates.push(data);
  }
  /** a brain only reports what happened to its own seat */
  onEvents(events: { kind: string; id?: string }[]): Incident[] {
    return events.filter((e) => e.id === this.id).map((e) => ({ cause: e.kind, t: 0, summary: '', detail: {} }));
  }
  decide(): InputState {
    return { mx: this.mx, my: -0.5, a1: this.press, a2: false };
  }
  trace() {
    return null;
  }
  metrics() {
    return { states: this.states.length };
  }
}

describe('playBots', () => {
  it('plays the round to the end and places the seats', () => {
    const r = playBots(new CountGame(30), ['a', 'b'], [new Brain(true), new Brain(false)], { tickRate: 60, snapEvery: 3, decideMs: 33 });
    expect(r.places).toEqual([1, 2]);
    expect(r.seconds).toBeGreaterThan(0.4);
    expect(r.seconds).toBeLessThan(1.5);
    expect(r.metrics[0].states).toBeGreaterThan(5);
  });

  it('gives bots snapshots every snapEvery ticks as JSON copies, stamped with the simulated clock', () => {
    const brain = new Brain(true);
    const game = new CountGame(30);
    playBots(game, ['a'], [brain], { tickRate: 60, snapEvery: 3 });
    expect(brain.states.slice(0, 3).map((s) => s.tick)).toEqual([0, 3, 6]);
    expect(brain.states[1].recvMs).toBe(50);
    expect(brain.states[0].score).not.toBe(brain.states[1].score);
  });

  it('sends the inputs the way the host does: sticks rounded to 0.01, one decision per decideMs', () => {
    const game = new CountGame(60);
    playBots(game, ['a'], [new Brain(true)], { tickRate: 60, decideMs: 100 });
    expect(game.inputs.a[0]).toEqual({ mx: 0.12, my: -0.5, a1: true, a2: false });
    expect(game.inputs.a.length).toBeGreaterThanOrEqual(Math.floor(60 / 6) - 1);
    expect(game.inputs.a.length).toBeLessThanOrEqual(60 / 6 + 1);
  });

  it('sends private state only when it changes, and only to its owner', () => {
    const game = new CountGame(60);
    const a = new Brain(true);
    const b = new Brain(true);
    playBots(game, ['a', 'b'], [a, b], { tickRate: 60, snapEvery: 3 });
    expect(a.privates).toEqual([{ secret: 0 }]);
    expect(b.privates).toEqual([null]);
  });

  it('counts incidents per seat and events per kind', () => {
    const r = playBots(new CountGame(10), ['a', 'b'], [new Brain(true, 'a'), new Brain(false, 'b')]);
    expect(r.causes[0]).toEqual({ goal: 1 });
    expect(r.causes[1]).toEqual({});
    expect(r.events.goal).toEqual([1, 0]);
  });

  it('stops at maxSeconds and times the decisions with the clock it is given', () => {
    let now = 0;
    const r = playBots(new CountGame(1e9), ['a'], [new Brain(false)], { tickRate: 60, maxSeconds: 1, clock: () => (now += 2) });
    expect(r.seconds).toBe(1);
    expect(r.places).toEqual([1]);
    expect(r.maxDecideMs).toBe(2);
    expect(r.avgDecideMs).toBe(2);
    expect(r.p99DecideMs).toBe(2);
  });
});
