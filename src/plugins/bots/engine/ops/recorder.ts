// Writes the per-match report that Claude Code (or a person) reads later to improve a game's AI.
//
//   <reportsDir>/<stamp>-<room>/
//     match.json        config, policy + params, per-round results and metrics, latency, incident counts
//     events.jsonl      game events, bot decision traces (~10 Hz) and phase changes, one JSON per line
//     incidents/NNN-<cause>.json   classified incident + the ~2 s of snapshots/inputs before it
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { Incident } from '../../../../core/shared/ai';

export interface RoundReport {
  index: number;
  gameId: string;
  gameName: string;
  variant: string;
  startedAt: string;
  durationS: number;
  placements: unknown;
  myPlace: number | null;
  myPoints: number | null;
  incidents: number;
  incidentCauses: Record<string, number>;
  metrics: Record<string, number>;
}

export interface MatchMeta {
  url: string;
  room: string;
  selfId: string;
  name: string;
  policy: string;
  level: string;
  scenario: string;
  seat: string;
  params: Record<string, number>;
  seed: number;
  serverConfig: unknown;
  selection: unknown;
}

const stats = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

export class Recorder {
  readonly dir: string;
  private events: WriteStream;
  private startedAt = new Date().toISOString();
  private rounds: RoundReport[] = [];
  private cur: { startedAt: string; t0: number; gameId: string; gameName: string; variant: string; incidents: number; causes: Record<string, number> } | null = null;
  private incidentSeq = 0;
  private ranking: unknown = null;
  readonly rtts: number[] = [];
  readonly snapshotGapsMs: number[] = [];
  inputsSent = 0;

  private readonly now: () => number;

  /** `dirName` replaces the default `<stamp>-<room>` folder; `now` is the clock that times rounds (default wall time) */
  constructor(reportsDir: string, private readonly meta: MatchMeta, opts: { dirName?: string; now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    const stamp = this.startedAt.replace(/[:.]/g, '-');
    this.dir = join(reportsDir, opts.dirName ?? `${stamp}-${meta.room}`);
    mkdirSync(join(this.dir, 'incidents'), { recursive: true });
    this.events = createWriteStream(join(this.dir, 'events.jsonl'), { flags: 'a' });
    this.flush();
  }

  log(kind: string, data: Record<string, unknown> = {}): void {
    this.events.write(JSON.stringify({ kind, ...data }) + '\n');
  }

  roundStart(gameId: string, gameName: string): void {
    this.cur = { startedAt: new Date().toISOString(), t0: this.now(), gameId, gameName, variant: '', incidents: 0, causes: {} };
    this.log('round-start', { index: this.rounds.length + 1, gameId, gameName });
  }

  setPolicy(policy: string, params: Record<string, number>): void {
    this.meta.policy = policy;
    this.meta.params = params;
    this.flush();
  }

  setVariant(variant: string): void {
    if (this.cur) this.cur.variant = variant;
  }

  incident(inc: Incident, window: { states: unknown[]; inputs: unknown[]; traces: unknown[] }): void {
    if (this.cur) {
      this.cur.incidents++;
      this.cur.causes[inc.cause] = (this.cur.causes[inc.cause] ?? 0) + 1;
    }
    const n = String(++this.incidentSeq).padStart(3, '0');
    const file = `incidents/${n}-${inc.cause}.json`;
    writeFileSync(join(this.dir, file), JSON.stringify({ round: this.rounds.length + 1, ...inc, ...window }, null, 1));
    this.log('incident', { file, cause: inc.cause, t: inc.t, summary: inc.summary });
  }

  roundEnd(placements: { id: string; place: number; points: number }[], metrics: Record<string, number>): void {
    if (!this.cur) return;
    const mine = placements.find((p) => p.id === this.meta.selfId);
    this.rounds.push({
      index: this.rounds.length + 1,
      gameId: this.cur.gameId,
      gameName: this.cur.gameName,
      variant: this.cur.variant,
      startedAt: this.cur.startedAt,
      durationS: +((this.now() - this.cur.t0) / 1000).toFixed(1),
      placements,
      myPlace: mine?.place ?? null,
      myPoints: mine?.points ?? null,
      incidents: this.cur.incidents,
      incidentCauses: this.cur.causes,
      metrics,
    });
    this.log('round-end', { placements, metrics });
    this.cur = null;
    this.flush();
  }

  matchEnd(ranking: unknown): void {
    this.ranking = ranking;
    this.log('match-end', { ranking });
    this.flush();
  }

  flush(): void {
    const report = {
      schema: 1,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      ...this.meta,
      rounds: this.rounds,
      ranking: this.ranking,
      latency: { rttMs: stats(this.rtts), snapshotGapMs: stats(this.snapshotGapsMs), inputsSent: this.inputsSent },
    };
    writeFileSync(join(this.dir, 'match.json'), JSON.stringify(report, null, 1));
  }

  /** Resolves once events.jsonl is written out. */
  close(): Promise<void> {
    this.flush();
    return new Promise((resolve) => this.events.end(resolve));
  }
}
