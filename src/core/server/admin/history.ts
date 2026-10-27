import { readFileSync, writeFileSync } from 'node:fs';
import { appendFile, rename, writeFile } from 'node:fs/promises';
import type { MatchRecord } from '../rooms/Room';

/**
 * The last `max` finished matches: a ring in memory, mirrored to a JSONL file (one match per
 * line). The file is compacted when it is loaded and again once it holds more than twice the
 * window, so it never grows without bound. Writes are async and serialized on one chain.
 */
export class MatchHistory {
  private matches: MatchRecord[] = [];
  /** matches seen since start-up, including ones already dropped from the ring */
  private total = 0;
  private writing: Promise<void> = Promise.resolve();
  /** lines currently in the file (once pending writes land) */
  private linesOnDisk = 0;

  constructor(
    private readonly file: string | null = null,
    private readonly max = 500,
  ) {
    if (!file) return;
    try {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      const valid: MatchRecord[] = [];
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as MatchRecord;
          if (typeof r?.ts === 'number' && Array.isArray(r.ranking) && Array.isArray(r.games)) valid.push(r);
        } catch {
          /* skip a damaged line */
        }
      }
      this.matches = valid.slice(-max);
      this.linesOnDisk = this.matches.length;
      // compact when the file holds more than the window, or any damaged lines
      if (lines.length > this.matches.length) writeFileSync(file, this.matches.map((m) => JSON.stringify(m)).join('\n') + '\n');
    } catch {
      /* no file yet */
    }
  }

  record(m: MatchRecord): void {
    this.total++;
    this.matches.push(m);
    if (this.matches.length > this.max) this.matches.splice(0, this.matches.length - this.max);
    if (!this.file) return;
    const file = this.file;
    const line = JSON.stringify(m) + '\n';
    this.linesOnDisk++;
    const compact = this.linesOnDisk > 2 * this.max;
    // snapshot now so later records cannot slip into (or out of) this rewrite
    const body = compact ? this.matches.map((x) => JSON.stringify(x)).join('\n') + '\n' : '';
    if (compact) this.linesOnDisk = this.matches.length;
    this.writing = this.writing
      .then(async () => {
        if (!compact) return appendFile(file, line);
        const tmp = `${file}.tmp`;
        await writeFile(tmp, body);
        await rename(tmp, file);
      })
      .catch((err) => console.error('[party-game] could not write match history', err));
  }

  /** Resolves once pending writes reached the disk (used by tests). */
  flush(): Promise<void> {
    return this.writing;
  }

  /** Newest first. */
  list(limit = 50): MatchRecord[] {
    return this.matches.slice(-Math.max(1, limit)).reverse();
  }

  get size(): number {
    return this.matches.length;
  }

  get playedSinceStart(): number {
    return this.total;
  }
}
