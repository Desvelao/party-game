import { readFileSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';

export interface AuditEntry {
  ts: number;
  action: string;
  target?: string;
  ip: string;
  detail?: unknown;
}

/**
 * Last `max` admin actions in memory, optionally mirrored to a JSONL file. The file is reloaded
 * and compacted to the last `max` valid lines at construction.
 */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly max = 500,
    private readonly file: string | null = null,
  ) {
    if (!file) return;
    try {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      const valid: AuditEntry[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as AuditEntry;
          if (typeof e?.ts === 'number' && typeof e.action === 'string' && typeof e.ip === 'string') valid.push(e);
        } catch {
          /* skip a damaged line */
        }
      }
      this.entries = valid.slice(-max);
      // compact when the file holds more than the window, or any damaged lines
      if (lines.length > this.entries.length) writeFileSync(file, this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    } catch {
      /* no file yet */
    }
  }

  record(entry: Omit<AuditEntry, 'ts'>): void {
    const full: AuditEntry = { ts: Date.now(), ...entry };
    this.entries.push(full);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    if (this.file) {
      const file = this.file;
      this.writing = this.writing
        .then(() => appendFile(file, JSON.stringify(full) + '\n'))
        .catch((err) => {
          console.error('[party-game] could not write audit log', err);
        });
    }
  }

  /** Resolves once pending writes reached the disk (used by tests and shutdown). */
  flush(): Promise<void> {
    return this.writing;
  }

  /** Newest first. */
  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  /** The newest `limit` entries as CSV (header row, newest first). */
  toCsv(limit = 500): string {
    const rows = this.list(limit).map((e) => [
      new Date(e.ts).toISOString(),
      e.action,
      e.target ?? '',
      e.ip,
      e.detail === undefined ? '' : JSON.stringify(e.detail),
    ]);
    return csvOf(['time', 'action', 'target', 'ip', 'detail'], rows);
  }
}

/**
 * RFC 4180 CSV. Cells that a spreadsheet would run as a formula (=, +, -, @ first) are prefixed
 * with a quote, since targets and details can carry player-chosen text.
 */
export function csvOf(header: string[], rows: string[][]): string {
  const cell = (v: string): string => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
