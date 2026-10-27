import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { normalizeRoomCode, normalizeSelection, type GameSelection } from '../../shared';
import type { RoomSnapshot } from './Room';

const FILE_VERSION = 1;

/**
 * The open lobbies, saved so a restart (an update, a crash) does not scatter the people who were
 * about to play. Only host settings are kept, never players or passwords; entries older than the
 * TTL are dropped when read.
 */
export class RoomStore {
  private writing: Promise<void> = Promise.resolve();
  private lastBody = '';

  constructor(
    private readonly file: string | null,
    private readonly ttlSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The saved lobbies that are still fresh and well formed. */
  load(): RoomSnapshot[] {
    if (!this.file) return [];
    let data: { rooms?: unknown };
    try {
      data = JSON.parse(readFileSync(this.file, 'utf8')) as { rooms?: unknown };
    } catch {
      return []; // no file yet, or one we cannot read: start empty
    }
    if (!Array.isArray(data.rooms)) return [];
    const out: RoomSnapshot[] = [];
    for (const r of data.rooms as Partial<RoomSnapshot>[]) {
      if (!r || normalizeRoomCode(r.code) !== r.code) continue;
      if (typeof r.savedAt !== 'number' || this.now() - r.savedAt > this.ttlSeconds * 1000) continue;
      const sel = r.selection as Partial<GameSelection> | undefined;
      const selection = sel && normalizeSelection(sel.game, sel.variant, sel.options, sel.playlist, sel.playlistRoundsToWin);
      if (!selection || typeof r.requestedMax !== 'number') continue;
      out.push({ code: r.code as string, selection, requestedMax: r.requestedMax, locked: r.locked === true, lateJoin: r.lateJoin === true, teams: r.teams === true, public: r.public === true, savedAt: r.savedAt });
    }
    return out;
  }

  /** Write the lobbies; a no-op when nothing changed since the last write. */
  save(rooms: RoomSnapshot[]): void {
    if (!this.file) return;
    const savedAt = this.now();
    const body = JSON.stringify({ version: FILE_VERSION, rooms: rooms.map((r) => ({ ...r, savedAt })) });
    // `savedAt` moves every call, so compare without it
    const key = JSON.stringify(rooms);
    if (key === this.lastBody) return;
    this.lastBody = key;
    const file = this.file;
    this.writing = this.writing
      .then(async () => {
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('[party-game] could not save rooms', err));
  }

  flush(): Promise<void> {
    return this.writing;
  }
}
