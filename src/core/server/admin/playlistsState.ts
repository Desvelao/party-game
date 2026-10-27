import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { MAX_OPERATOR_PLAYLISTS, validatePlaylist, type OperatorPlaylist } from '../../shared';

/** What the admin did to one playlist id: replace/add it, or hide it (`null`). */
type Override = OperatorPlaylist | null;
type Overrides = Record<string, Override>;

export type PlaylistSource = 'config file' | 'admin';

/**
 * Operator playlists: the config file's list overlaid by the admin's changes. An admin entry
 * replaces a file playlist of the same id (or adds a new one); `null` hides a file playlist.
 * Admin changes are persisted in the data dir; "restore" drops them for one id.
 */
export class PlaylistsState {
  private admin: Overrides = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string | null = null,
    private readonly fromFile: OperatorPlaylist[] = [],
  ) {
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        for (const [id, v] of Object.entries(raw)) {
          if (v === null) this.admin[id] = null;
          else {
            const res = validatePlaylist(v, id);
            if (res.value && res.value.id === id) this.admin[id] = res.value;
          }
        }
      }
    } catch {
      /* no file yet */
    }
  }

  /** The playlists hosts are offered: file playlists in order (replaced or hidden by admin), then admin additions. */
  effective(): OperatorPlaylist[] {
    const out: OperatorPlaylist[] = [];
    const used = new Set<string>();
    for (const p of this.fromFile) {
      used.add(p.id);
      const o = this.admin[p.id];
      if (o === null) continue;
      out.push(o ?? p);
    }
    for (const [id, o] of Object.entries(this.admin)) if (o && !used.has(id)) out.push(o);
    return out;
  }

  /** Every known playlist with where it came from, including hidden file ones (for the admin UI). */
  list(): { playlist: OperatorPlaylist; source: PlaylistSource; hidden: boolean; fileVersion: boolean }[] {
    const rows: { playlist: OperatorPlaylist; source: PlaylistSource; hidden: boolean; fileVersion: boolean }[] = [];
    const used = new Set<string>();
    for (const p of this.fromFile) {
      used.add(p.id);
      const o = this.admin[p.id];
      rows.push({ playlist: o ?? p, source: o ? 'admin' : 'config file', hidden: o === null, fileVersion: true });
    }
    for (const [id, o] of Object.entries(this.admin)) {
      if (o && !used.has(id)) rows.push({ playlist: o, source: 'admin', hidden: false, fileVersion: false });
    }
    return rows;
  }

  /** Add or replace a playlist. `id` comes from the URL and wins over any id in the body. */
  put(id: string, raw: unknown): { ok: true; playlist: OperatorPlaylist } | { ok: false; errors: string[] } {
    const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as object), id } : raw;
    const res = validatePlaylist(body, id);
    if (!res.value) return { ok: false, errors: res.errors };
    const exists = this.fromFile.some((p) => p.id === id) || this.admin[id] !== undefined;
    if (!exists && this.effective().length >= MAX_OPERATOR_PLAYLISTS) {
      return { ok: false, errors: [`at most ${MAX_OPERATOR_PLAYLISTS} playlists are allowed`] };
    }
    this.admin = { ...this.admin, [id]: res.value };
    this.persist();
    return { ok: true, playlist: res.value };
  }

  /** Delete an admin playlist, or hide a config file one. False when the id is unknown. */
  remove(id: string): boolean {
    const inFile = this.fromFile.some((p) => p.id === id);
    if (!inFile && !this.admin[id]) return false;
    if (inFile) this.admin = { ...this.admin, [id]: null };
    else {
      const { [id]: _gone, ...rest } = this.admin;
      this.admin = rest;
    }
    this.persist();
    return true;
  }

  /** Drop the admin change for this id: a file playlist is back as written. False when nothing was changed. */
  restore(id: string): boolean {
    if (!(id in this.admin)) return false;
    const { [id]: _gone, ...rest } = this.admin;
    this.admin = rest;
    this.persist();
    return true;
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private persist(): void {
    if (!this.file) return;
    const file = this.file;
    const body = JSON.stringify(this.admin);
    this.writing = this.writing
      .then(async () => {
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('[party-game] could not save playlists', err));
  }
}
