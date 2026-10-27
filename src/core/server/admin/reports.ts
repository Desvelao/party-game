import { readFileSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import type { AdminRoute } from './api';
import { csvOf } from './audit';

/** A player's report about another player, as the operator sees it. */
export interface ReportEntry {
  ts: number;
  room: string;
  reporterId: string;
  reporter: string;
  targetId: string;
  target: string;
  /** the reported seat's profile id when they were signed in (lets the operator ban or shadow-ban them) */
  targetProfileId?: string;
}

/** Last `max` reports in memory, mirrored to a JSONL file like the audit log. */
export class ReportLog {
  private entries: ReportEntry[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly max = 200,
    private readonly file: string | null = null,
  ) {
    if (!file) return;
    try {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      const valid: ReportEntry[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as ReportEntry;
          if (typeof e?.ts === 'number' && typeof e.room === 'string' && typeof e.target === 'string') valid.push(e);
        } catch {
          /* skip a damaged line */
        }
      }
      this.entries = valid.slice(-max);
      if (lines.length > this.entries.length) this.rewrite();
    } catch {
      /* no file yet */
    }
  }

  private rewrite(): void {
    if (this.file) writeFileSync(this.file, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''));
  }

  record(entry: Omit<ReportEntry, 'ts'>): void {
    const full: ReportEntry = { ts: Date.now(), ...entry };
    this.entries.push(full);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    if (this.file) {
      const file = this.file;
      this.writing = this.writing.then(() => appendFile(file, JSON.stringify(full) + '\n')).catch((err) => console.error('[party-game] could not write report log', err));
    }
  }

  /** Resolves once pending writes reached the disk (used by tests and shutdown). */
  flush(): Promise<void> {
    return this.writing;
  }

  /** Newest first. */
  list(limit = 100): ReportEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  clear(): number {
    const n = this.entries.length;
    this.entries = [];
    try {
      this.rewrite();
    } catch {
      /* in-memory list is already empty */
    }
    return n;
  }

  toCsv(limit = 200): string {
    return csvOf(
      ['time', 'room', 'reporter', 'target', 'targetProfileId'],
      this.list(limit).map((e) => [new Date(e.ts).toISOString(), e.room, e.reporter, e.target, e.targetProfileId ?? '']),
    );
  }
}

/** GET /reports[?limit&format=csv], DELETE /reports (clear all). */
export const reportRoutes: AdminRoute = (ctx, method, path) => {
  if (path !== '/reports') return false;
  if (!ctx.reports) {
    ctx.json(404, { error: 'unavailable' });
    return true;
  }
  if (method === 'GET') {
    const limit = Math.min(200, Math.max(1, Number.parseInt(ctx.url.searchParams.get('limit') ?? '100', 10) || 100));
    if (ctx.url.searchParams.get('format') === 'csv') ctx.text(200, ctx.reports.toCsv(limit), 'text/csv; charset=utf-8', 'party-game-reports.csv');
    else ctx.json(200, { reports: ctx.reports.list(limit) });
    return true;
  }
  if (method === 'DELETE') {
    const cleared = ctx.reports.clear();
    ctx.audit.record({ action: 'reports.clear', ip: ctx.ip, detail: { cleared } });
    ctx.json(200, { cleared });
    return true;
  }
  return false;
};
