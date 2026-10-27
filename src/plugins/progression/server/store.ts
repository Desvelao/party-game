// Where the progression plugin keeps its data: one JSON file in the plugin's data folder, keyed by profile id,
// written a moment after a change (atomic: temp file + rename). A corrupt file is moved aside.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emptyProgress, reviveProgress, type Progress } from './progress';

const FILE_VERSION = 1;
const SAVE_DELAY_MS = 2000;

export class ProgressStore {
  private readonly map = new Map<string, Progress>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly file: string | null;

  constructor(dataDir: string | null) {
    this.file = dataDir ? join(dataDir, 'progression.json') : null;
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { version?: number; players?: Record<string, unknown> };
      for (const [id, v] of Object.entries(raw.players ?? {})) this.map.set(id, reviveProgress(v));
    } catch {
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {
        /* nothing more to do */
      }
    }
  }

  get size(): number {
    return this.map.size;
  }

  get(id: string): Progress | undefined {
    return this.map.get(id);
  }

  /** The record of `id`, created when there is none. Call `touch()` after changing it. */
  ensure(id: string): Progress {
    let p = this.map.get(id);
    if (!p) this.map.set(id, (p = emptyProgress()));
    return p;
  }

  entries(): IterableIterator<[string, Progress]> {
    return this.map.entries();
  }

  delete(id: string): boolean {
    const had = this.map.delete(id);
    if (had) this.touch();
    return had;
  }

  touch(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, players: Object.fromEntries(this.map) }));
      renameSync(tmp, this.file);
    } catch {
      /* the next change tries again */
    }
  }
}
