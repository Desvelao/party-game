// Who changed what: the last actions of the admin panel/API, kept in memory and appended to dataDir/audit.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface AuditEntry {
  ts: number;
  action: string;
  ip: string;
  target?: string;
  detail?: unknown;
}

const KEEP = 200;

export class AuditLog {
  private entries: AuditEntry[] = [];
  private readonly file: string | null;

  constructor(dataDir: string | null) {
    this.file = dataDir ? join(dataDir, 'audit.jsonl') : null;
    if (this.file && existsSync(this.file)) {
      try {
        const lines = readFileSync(this.file, 'utf8').trim().split('\n').slice(-KEEP);
        this.entries = lines.map((l) => JSON.parse(l) as AuditEntry);
      } catch {
        /* unreadable history: start empty */
      }
    }
  }

  record(e: Omit<AuditEntry, 'ts'>): void {
    const entry: AuditEntry = { ts: Date.now(), ...e };
    this.entries.push(entry);
    if (this.entries.length > KEEP) this.entries.shift();
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('[bots] could not write the audit log', (err as Error).message);
    }
  }

  /** newest first */
  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(limit, KEEP))).reverse();
  }
}
