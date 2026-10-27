import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export type BanKind = 'ip' | 'profile';

export interface BanEntry {
  kind: BanKind;
  value: string;
  reason?: string;
  createdAt: number;
  /** epoch ms; absent = until lifted */
  expiresAt?: number;
}

const MAX_BANS = 1000;

/**
 * Banned IPs and profile ids. Held in memory, mirrored to a JSON file (when given) so bans
 * survive a restart. Expired entries are dropped lazily.
 */
export class BanList {
  private bans = new Map<string, BanEntry>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string | null = null,
    private readonly clock: () => number = Date.now,
  ) {
    if (!file) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(data)) {
        for (const e of data) {
          if (e && (e.kind === 'ip' || e.kind === 'profile') && typeof e.value === 'string') {
            this.bans.set(key(e.kind, e.value), {
              kind: e.kind,
              value: e.value,
              ...(typeof e.reason === 'string' ? { reason: e.reason.slice(0, 200) } : {}),
              createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0,
              ...(typeof e.expiresAt === 'number' ? { expiresAt: e.expiresAt } : {}),
            });
          }
        }
      }
    } catch {
      /* no file yet, or unreadable: start empty */
    }
  }

  /** The active ban for `value`, dropping it first when it has expired. */
  get(kind: BanKind, value: string | null | undefined): BanEntry | null {
    if (!value) return null;
    const k = key(kind, value);
    const e = this.bans.get(k);
    if (!e) return null;
    if (e.expiresAt !== undefined && e.expiresAt <= this.clock()) {
      this.bans.delete(k);
      this.persist();
      return null;
    }
    return e;
  }

  isBanned(kind: BanKind, value: string | null | undefined): boolean {
    return this.get(kind, value) !== null;
  }

  /** What a banned player is told: the operator's reason and the minutes left (rounded up). */
  describe(kind: BanKind, value: string | null | undefined): { reason?: string; minutes?: number } {
    const e = this.get(kind, value);
    if (!e) return {};
    return {
      ...(e.reason ? { reason: e.reason } : {}),
      ...(e.expiresAt !== undefined ? { minutes: Math.max(1, Math.ceil((e.expiresAt - this.clock()) / 60_000)) } : {}),
    };
  }

  list(): BanEntry[] {
    const now = this.clock();
    let pruned = false;
    for (const [k, e] of this.bans) {
      if (e.expiresAt !== undefined && e.expiresAt <= now) {
        this.bans.delete(k);
        pruned = true;
      }
    }
    if (pruned) this.persist();
    return [...this.bans.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Re-adding an entry replaces it (new reason / expiry). False when the list is full. */
  add(kind: BanKind, value: string, opts: { reason?: string; minutes?: number } = {}): BanEntry | null {
    const k = key(kind, value);
    if (!this.bans.has(k) && this.bans.size >= MAX_BANS) return null;
    const now = this.clock();
    const entry: BanEntry = {
      kind,
      value,
      ...(opts.reason ? { reason: opts.reason.slice(0, 200) } : {}),
      createdAt: now,
      ...(opts.minutes && opts.minutes > 0 ? { expiresAt: now + opts.minutes * 60_000 } : {}),
    };
    this.bans.set(k, entry);
    this.persist();
    return entry;
  }

  remove(kind: BanKind, value: string): boolean {
    const had = this.bans.delete(key(kind, value));
    if (had) this.persist();
    return had;
  }

  /** Resolves once pending writes reached the disk (used by tests and shutdown). */
  flush(): Promise<void> {
    return this.writing;
  }

  private persist(): void {
    if (!this.file) return;
    const file = this.file;
    const body = JSON.stringify([...this.bans.values()], null, 2);
    this.writing = this.writing
      .then(async () => {
        const tmp = `${file}.tmp`;
        await writeFile(tmp, body);
        await rename(tmp, file);
      })
      .catch((err) => console.error('[party-game] could not save bans', err));
  }
}

const key = (kind: BanKind, value: string) => `${kind}:${value}`;
