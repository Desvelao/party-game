// Bots that run inside the game server: no sockets and no threads. A bot is a BotBrain behind a virtual client the
// room talks to as if it were a player's connection; one shared timer (`tick`) makes every bot decide, so the cost
// is a function call per bot and no isolate or timer per bot (this has to run on a Raspberry Pi Zero too).
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { randomLook, type CharacterModelDef, type Looks } from '../../../core/shared/kit/looks';
import type { PluginClient, ServerMessage, VirtualPlayerRoom } from '../../../core/shared';
import { BotBrain } from './brain';
import { Recorder } from './ops/recorder';
import type { BotHandle, BotRunner, BotSpec, BotUsage, RunnerHooks } from './types';

/** The room sends the same JSON string to every client: parse it once for all the bots of the room. */
let lastJson = '';
let lastMsg: ServerMessage | null = null;
function parseOnce(json: string): ServerMessage {
  if (json !== lastJson) {
    lastMsg = JSON.parse(json) as ServerMessage;
    lastJson = json;
  }
  return lastMsg!;
}

class VirtualBot implements PluginClient, BotHandle {
  name: string;
  profileId = null;
  looks: Looks;
  preferredColor = null;
  roomCode: string | null = null;
  ip = '';
  readonly id = `bot-${randomBytes(4).toString('hex')}`;
  private brain: BotBrain;
  private ended = false;
  private timers = new Set<NodeJS.Timeout>();
  private busyMs = 0;
  private sampledAt = performance.now();

  constructor(
    private readonly room: VirtualPlayerRoom,
    spec: BotSpec,
    private readonly hooks: RunnerHooks,
    private readonly pluginId: string,
    models: readonly CharacterModelDef[] = [],
  ) {
    this.name = spec.name;
    this.looks = Object.fromEntries(models.map((m) => [m.id, randomLook(m)]));
    this.brain = new BotBrain(
      { name: spec.name, minPlayers: 2, startDelayMs: 0, resultsDelayMs: 0, matches: 0, params: {}, seed: spec.seed, level: spec.plan.level || undefined, policy: spec.plan.policy, passive: true, log: (l) => hooks.onLog(l), onEvent: (e) => hooks.onEvent(e), makeRecorder: spec.reports.enabled ? (w) => new Recorder(spec.reports.dir, { url: '(in the game server)', room: w.code, selfId: w.id, name: spec.name, policy: '', level: spec.plan.level, scenario: 'embedded', seat: spec.name, params: {}, seed: spec.seed, serverConfig: w.config, selection: w.selection }) : undefined },
      {
        send: (m) => {
          if (m.t === 'READY' || m.t === 'INPUT' || m.t === 'VOTE') this.room.virtualSend(this.id, m);
        },
        after: (ms, fn) => {
          const t = setTimeout(() => {
            this.timers.delete(t);
            fn();
          }, ms);
          this.timers.add(t);
          return () => {
            clearTimeout(t);
            this.timers.delete(t);
          };
        },
        stop: (reason, error) => this.end(reason, error?.message),
      },
    );
    // the brain's parameters come from the AI's level: BotBrain resolves them from `level` and `params`
  }

  /** Take the seat. Returns the reason it failed, or null. */
  join(spec: BotSpec): string | null {
    const seat = spec.auth?.seat;
    const r = this.room.joinVirtual(this, { plugin: this.pluginId, yields: !seat, seat, ext: { level: spec.plan.level, added: !!seat } });
    return r.ok ? null : r.message;
  }

  // ---- what the room calls ---------------------------------------------------------------------

  send(json: string): void {
    if (this.ended) return;
    const t0 = performance.now();
    try {
      this.brain.handle(parseOnce(json));
    } catch (err) {
      this.hooks.onLog(`message error: ${(err as Error).message}`);
    }
    this.busyMs += performance.now() - t0;
  }

  close(): void {
    this.end('closed');
  }

  // ---- what the shared timer and the manager call ----------------------------------------------

  decide(): void {
    if (this.ended) return;
    const t0 = performance.now();
    try {
      this.brain.tick();
    } catch (err) {
      this.hooks.onLog(`decide error: ${(err as Error).message}`);
    }
    this.busyMs += performance.now() - t0;
  }

  stop(reason: string): void {
    this.end(reason, undefined, true);
  }

  usage(): BotUsage {
    const now = performance.now();
    const cpu = Math.min(100, (this.busyMs / Math.max(1, now - this.sampledAt)) * 100);
    this.busyMs = 0;
    this.sampledAt = now;
    return { cpu: Math.round(cpu * 10) / 10, heapMB: 0, externalMB: 0 };
  }

  private end(reason: string, error?: string, leave = false): void {
    if (this.ended) return;
    this.ended = true;
    this.timers.forEach(clearTimeout);
    this.brain.close();
    this.hooks.onEvent({ kind: 'closed', reason });
    if (leave) this.room.removeVirtual(this.id);
    onEnd(this);
    this.hooks.onExit(error);
  }
}

let onEnd: (b: VirtualBot) => void = () => {};

export class InProcessRunner implements BotRunner {
  private bots = new Set<VirtualBot>();

  constructor(
    private readonly rooms: { get(code: string): VirtualPlayerRoom | undefined },
    private readonly pluginId = 'bots',
    /** the installed character models (a bot gets a random look of each) */
    private readonly models: () => readonly CharacterModelDef[] = () => [],
  ) {
    onEnd = (b) => this.bots.delete(b);
  }

  start(spec: BotSpec, hooks: RunnerHooks): BotHandle {
    const room = this.rooms.get(spec.room);
    const bot = room ? new VirtualBot(room, spec, hooks, this.pluginId, this.models()) : null;
    // report the outcome after the caller has stored the handle (the manager registers it right after `start`)
    queueMicrotask(() => {
      if (!bot) return hooks.onExit('room closed');
      this.bots.add(bot);
      const failed = bot.join(spec);
      if (failed) {
        this.bots.delete(bot);
        hooks.onEvent({ kind: 'closed', reason: failed });
        hooks.onExit(failed);
      }
    });
    return bot ?? { stop: () => {}, usage: () => ({ cpu: 0, heapMB: 0, externalMB: 0 }) };
  }

  /** Every bot decides once (call this from the shared timer). */
  tick(): void {
    for (const b of this.bots) b.decide();
  }

  get size(): number {
    return this.bots.size;
  }
}
