// WebSocket player: joins (or creates) a room, plays the lobby protocol and drives a GameBot once a round runs.
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/core/shared';
import { BotBrain, type BotEvent } from './brain';
import { Recorder } from './recorder';

export interface ClientOptions {
  url: string;
  name: string;
  code?: string;
  password?: string;
  /** used only when creating a room (no code) */
  create?: { game?: string; variant?: string; options?: Record<string, number | boolean | string>; playlist?: { game: string; variant?: string; options?: Record<string, number | boolean | string> }[] };
  /** host only: start once this many players (bot included) are in the room and ready */
  minPlayers: number;
  startDelayMs: number;
  resultsDelayMs: number;
  /** stop after this many finished matches; 0 = run until killed */
  matches: number;
  reportsDir: string;
  /** policy name override; default is the plugin's */
  policy?: string;
  params: Record<string, number>;
  seed: number;
  /** difficulty preset of the game's plugin (e.g. easy, hard) */
  level?: string;
  /** scenario name and seat label, written to the report so analysis can group runs */
  scenario?: string;
  seat?: string;
  /** called once with the room code after joining */
  onJoined?: (code: string) => void;
  /** write the per-match report (default true) */
  reports?: boolean;
  /** companion mode: never host or start games; leave the room if the host role falls to this bot */
  passive?: boolean;
  /** seating a bot through the game server's bots plugin: its secret, and the claim (level, reserved seat) */
  plugin?: { id: string; token?: string; data: Record<string, unknown> };
  /** structured progress for dashboards (the companion server) */
  onEvent?: (e: BotEvent) => void;
  log: (line: string) => void;
}

export type { BotEvent };

export const INPUT_MS = 33;

/** A bot over a WebSocket: connects (and resumes after a drop), runs the ping and decision timers around a BotBrain. */
export class BotClient {
  private ws!: WebSocket;
  private brain: BotBrain;
  private stopping = false;
  private done!: () => void;
  private fail!: (e: Error) => void;
  private timers: NodeJS.Timeout[] = [];
  private afterTimers = new Set<NodeJS.Timeout>();
  private retries = 0;

  constructor(private readonly o: ClientOptions) {
    this.brain = new BotBrain(
      {
        name: o.name,
        minPlayers: o.minPlayers,
        startDelayMs: o.startDelayMs,
        resultsDelayMs: o.resultsDelayMs,
        matches: o.matches,
        policy: o.policy,
        params: o.params,
        seed: o.seed,
        level: o.level,
        passive: o.passive,
        onEvent: o.onEvent,
        log: o.log,
        onJoined: o.onJoined,
        makeRecorder:
          o.reports === false
            ? undefined
            : (w) =>
                new Recorder(o.reportsDir, {
                  url: o.url,
                  room: w.code,
                  selfId: w.id,
                  name: o.name,
                  policy: '',
                  level: o.level ?? '',
                  scenario: o.scenario ?? '',
                  seat: o.seat ?? '',
                  params: {},
                  seed: o.seed,
                  serverConfig: w.config,
                  selection: w.selection,
                }),
      },
      {
        send: (m) => this.send(m),
        after: (ms, fn) => {
          const t = setTimeout(() => {
            this.afterTimers.delete(t);
            fn();
          }, ms);
          this.afterTimers.add(t);
          return () => {
            clearTimeout(t);
            this.afterTimers.delete(t);
          };
        },
        stop: (reason, error) => {
          this.stop(reason);
          if (error) this.fail(error);
        },
      },
    );
  }

  run(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.done = resolve;
      this.fail = reject;
      this.connect(this.o.code);
    });
  }

  stop(reason = 'stopped'): void {
    if (this.stopping) return;
    this.stopping = true;
    this.o.onEvent?.({ kind: 'closed', reason });
    this.timers.forEach(clearInterval);
    this.afterTimers.forEach(clearTimeout);
    this.brain.close();
    try {
      this.ws.close(1000);
    } catch {
      /* already closed */
    }
    this.done();
  }

  private connect(code?: string): void {
    if (this.stopping) return;
    const ws = new WebSocket(this.o.url);
    this.ws = ws;
    ws.on('open', () => {
      const create = !code ? this.o.create : undefined;
      this.send({
        t: 'JOIN_ROOM',
        v: PROTOCOL_VERSION,
        name: this.o.name,
        code,
        ...(this.brain.resume && code ? { resume: this.brain.resume } : {}),
        ...(this.o.password ? { password: this.o.password } : {}),
        ...(this.o.plugin && code ? { plugin: this.o.plugin } : {}),
        ...(create?.game ? { game: create.game, variant: create.variant, ...(create.options && Object.keys(create.options).length ? { options: create.options } : {}), ...(create.playlist ? { playlist: create.playlist } : {}) } : {}),
      } as ClientMessage);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        this.brain.handle(msg);
        if (msg.t === 'WELCOME') {
          this.retries = 0;
          this.timers.forEach(clearInterval);
          this.timers = [setInterval(() => this.send({ t: 'PING', ts: performance.now() }), 1000), setInterval(() => this.brain.tick(), INPUT_MS)];
        }
      } catch (e) {
        this.o.log(`message error: ${(e as Error).message}`);
      }
    });
    ws.on('error', (e) => {
      if (!this.brain.joined) this.fail(e as Error);
    });
    ws.on('close', (codeNo) => {
      this.timers.forEach(clearInterval);
      this.timers = [];
      if (this.stopping) return;
      if (this.brain.joined && this.brain.code && this.retries < 8) {
        const wait = Math.min(5000, 500 * 2 ** this.retries++);
        this.o.log(`connection lost (${codeNo}), resuming in ${wait} ms`);
        const t = setTimeout(() => {
          this.afterTimers.delete(t);
          this.connect(this.brain.code);
        }, wait);
        this.afterTimers.add(t);
      } else {
        this.o.log(`connection closed (${codeNo})`);
        this.stop(`closed ${codeNo}`);
      }
    });
  }

  private send(m: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
