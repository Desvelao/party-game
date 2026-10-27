import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import type { MaintenanceInfo } from '../../shared';

/** How many delivered announcements players can re-read, and how many may wait for their time. */
export const MAX_RECENT = 10;
export const MAX_PENDING = 20;

export interface Announcement {
  id: string;
  message: string;
  /** when it goes out (epoch ms) */
  at: number;
  /** pinned only: when the banner goes away (absent = until an operator removes it) */
  until?: number;
  /** also kept as a banner for everyone, including players who connect later */
  pinned: boolean;
  /** the toast went out; a pinned one stays listed until it expires */
  sent: boolean;
}

export interface MaintenanceSnapshot {
  draining: boolean;
  message: string;
  exitWhenEmpty: boolean;
  announcements: Announcement[];
  recent: { id: string; message: string; at: number }[];
}

/**
 * Drain mode (no new rooms, running matches finish) and operator announcements, which are sent
 * once as a toast and, when pinned, stay on screen for everyone who connects until they expire.
 * Persisted, so a restart keeps the banner and the schedule.
 */
export class MaintenanceState {
  private draining = false;
  private message = '';
  private exitWhenEmpty = false;
  private announcements: Announcement[] = [];
  private recent: { id: string; message: string; at: number }[] = [];
  private seq = 0;
  private writing: Promise<void> = Promise.resolve();
  private listeners: (() => void)[] = [];

  constructor(
    private readonly file: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    if (!file) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<MaintenanceSnapshot>;
      this.draining = data.draining === true;
      this.message = typeof data.message === 'string' ? data.message : '';
      this.exitWhenEmpty = data.exitWhenEmpty === true;
      if (Array.isArray(data.announcements)) {
        this.announcements = data.announcements.filter(
          (a): a is Announcement => !!a && typeof a.id === 'string' && typeof a.message === 'string' && typeof a.at === 'number',
        );
      }
      if (Array.isArray(data.recent)) this.recent = data.recent.filter((r) => !!r && typeof r.message === 'string').slice(0, MAX_RECENT);
    } catch {
      /* no file yet */
    }
  }

  /** Called after an operator change (not after `tick`, which the caller drives). */
  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  get isDraining(): boolean {
    return this.draining;
  }

  get exitsWhenEmpty(): boolean {
    return this.draining && this.exitWhenEmpty;
  }

  setDraining(draining: boolean, opts: { message?: string; exitWhenEmpty?: boolean } = {}): void {
    this.draining = draining;
    this.message = draining ? (opts.message ?? this.message) : '';
    this.exitWhenEmpty = draining && opts.exitWhenEmpty === true;
    this.persist();
  }

  /** Schedule an announcement; null when too many wait already. */
  announce(message: string, opts: { at?: number; durationMs?: number; pinned?: boolean } = {}): Announcement | null {
    if (this.announcements.filter((a) => !a.sent).length >= MAX_PENDING) return null;
    const at = opts.at ?? this.now();
    const pinned = opts.pinned === true;
    const a: Announcement = {
      id: `${this.now().toString(36)}${(this.seq++).toString(36)}`,
      message,
      at,
      pinned,
      sent: false,
      ...(pinned && opts.durationMs ? { until: at + opts.durationMs } : {}),
    };
    this.announcements.push(a);
    this.persist();
    return a;
  }

  remove(id: string): boolean {
    const n = this.announcements.length;
    this.announcements = this.announcements.filter((a) => a.id !== id);
    if (this.announcements.length === n) return false;
    this.persist();
    return true;
  }

  /** Take one delivered announcement out of the history players can re-read. */
  removeRecent(id: string): boolean {
    const n = this.recent.length;
    this.recent = this.recent.filter((r) => r.id !== id);
    if (this.recent.length === n) return false;
    this.persist();
    return true;
  }

  /** Empty the history players can re-read. */
  clearRecent(): void {
    this.recent = [];
    this.persist();
  }

  /** Drop drain mode and every announcement (the history stays). */
  clear(): void {
    this.draining = false;
    this.message = '';
    this.exitWhenEmpty = false;
    this.announcements = [];
    this.persist();
  }

  /**
   * Called about once a second: the announcements whose time has come (to send), and whether what
   * players see changed (a banner started or ended), so the caller knows to send the state again.
   */
  tick(): { due: Announcement[]; changed: boolean } {
    const now = this.now();
    let due: Announcement[] = [];
    let changed = false;
    for (const a of this.announcements) {
      if (!a.sent && a.at <= now) {
        a.sent = true;
        due.push(a);
        this.recent.unshift({ id: a.id, message: a.message, at: a.at });
        changed = true;
      }
    }
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
    const before = this.announcements.length;
    // a toast-only announcement is done once sent; a pinned one when it expires
    this.announcements = this.announcements.filter((a) => !a.sent || (a.pinned && (a.until === undefined || a.until > now)));
    if (this.announcements.length !== before) changed = true;
    if (!changed) due = [];
    else this.persist(false);
    return { due, changed };
  }

  /** What every player may see. */
  info(): MaintenanceInfo {
    return {
      draining: this.draining,
      ...(this.draining && this.message ? { message: this.message } : {}),
      banners: this.announcements.filter((a) => a.sent && a.pinned).map((a) => ({ id: a.id, message: a.message })),
      recent: this.recent.map((r) => ({ id: r.id, message: r.message, at: r.at })),
    };
  }

  /** The operator's view, with what still waits. */
  snapshot(): MaintenanceSnapshot {
    return {
      draining: this.draining,
      message: this.message,
      exitWhenEmpty: this.exitWhenEmpty,
      announcements: this.announcements.map((a) => ({ ...a })),
      recent: this.recent.map((r) => ({ ...r })),
    };
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private persist(notify = true): void {
    if (notify) for (const fn of this.listeners) fn();
    if (!this.file) return;
    const file = this.file;
    const body = JSON.stringify(this.snapshot());
    this.writing = this.writing
      .then(async () => {
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('[party-game] could not save maintenance state', err));
  }
}
