import { readFileSync, renameSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MemoryProfileRepository } from './MemoryProfileRepository';
import { reviveRecord } from './profile';

const FILE_VERSION = 1;
/** A flush (serialising plus writing the whole store) slower than this is reported: the store has outgrown the board. */
export const SLOW_FLUSH_MS = 250;

/**
 * JSON-file store (the "json" driver): everything is kept in memory (the read path) and flushed to disk with
 * debounced atomic writes (tmp + rename), so a crash never leaves a half-written file. The write is asynchronous and
 * one at a time (like BanList), so a big store never blocks the game loop on the disk.
 */
export class JsonProfileRepository extends MemoryProfileRepository {
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    maxProfiles = 10_000,
    private readonly flushMs = 500,
    clock: () => number = Date.now,
  ) {
    super(maxProfiles, clock);
    this.load();
  }

  private load(): void {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return; // first run
    }
    try {
      const data = JSON.parse(text) as { profiles?: Record<string, unknown> };
      const now = this.clock();
      for (const [id, raw] of Object.entries(data.profiles ?? {})) {
        const rec = reviveRecord(raw, now);
        if (rec && this.records.size < this.maxProfiles) this.records.set(id, rec);
      }
    } catch {
      // unreadable: keep the bytes for inspection and start empty
      try {
        renameSync(this.file, `${this.file}.corrupt-${this.clock()}`);
      } catch {
        /* nothing more to do */
      }
      console.error(`[party-game] profile store ${this.file} was corrupt; moved aside, starting empty`);
    }
  }

  protected override changed(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushMs);
    this.timer.unref();
  }

  /** Resolves once everything changed so far is on disk. Writes never overlap: each waits for the one before. */
  private flush(): Promise<void> {
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const t0 = performance.now();
    const body = JSON.stringify({ version: FILE_VERSION, profiles: Object.fromEntries(this.records) });
    const count = this.records.size;
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, body);
        await rename(tmp, this.file);
        const ms = performance.now() - t0;
        if (ms > SLOW_FLUSH_MS) console.warn(`[party-game] profile store flush took ${Math.round(ms)} ms for ${count} profiles; consider the sqlite store`);
      })
      .catch((err) => {
        this.dirty = true;
        console.error('[party-game] could not write profile store', err);
      });
    return this.writing;
  }

  override async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
