import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { ALL_PLAYABLES, ALL_VARIANTS, CATALOG, CUSTOM, MIXED, selectionRounds, type GameSelection } from '../../shared';

/** Ids an operator may switch off: a whole game family, or one playable variant. */
/** Read on each use: installed game packs register after this module loads. */
const known = () => new Set<string>([...CATALOG.map((g) => g.id), ...ALL_PLAYABLES.map((p) => p.id)]);

/**
 * Which games and variants are switched off. Switching off a game family switches off all its
 * variants. Enforced on the server only, where selections are accepted and rounds are built.
 */
export class CatalogState {
  private disabled = new Set<string>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string | null = null) {
    if (!file) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      const KNOWN = known();
      if (Array.isArray(data)) this.disabled = new Set(data.filter((id): id is string => typeof id === 'string' && KNOWN.has(id)));
      if (this.enabledPlayables().length === 0) this.disabled.clear();
    } catch {
      /* no file yet */
    }
  }

  list(): string[] {
    return [...this.disabled].sort();
  }

  /** Can a round with this playable id be played? */
  isPlayableEnabled(id: string): boolean {
    if (this.disabled.has(id)) return false;
    const p = ALL_PLAYABLES.find((x) => x.id === id);
    return !(p && this.disabled.has(p.game));
  }

  enabledPlayables() {
    return ALL_PLAYABLES.filter((p) => this.isPlayableEnabled(p.id));
  }

  /** Reason a host-chosen selection is refused, or null when it is fine. */
  check(sel: GameSelection): string | null {
    if (this.disabled.size === 0) return null;
    const rounds = selectionRounds(sel);
    if (sel.game === CUSTOM) {
      const bad = rounds.find((r) => !this.isPlayableEnabled(r.id));
      return bad ? `${bad.name} is currently disabled` : null;
    }
    // mixed / all-variants simply skip disabled entries; an explicit pick must be available
    if (sel.game !== MIXED && sel.variant !== ALL_VARIANTS && rounds.every((r) => !this.isPlayableEnabled(r.id))) {
      return `${rounds[0]?.name ?? sel.game} is currently disabled`;
    }
    if (rounds.every((r) => !this.isPlayableEnabled(r.id))) return 'That game is currently disabled';
    return null;
  }

  /**
   * Replace the disabled set. Refuses unknown ids and a set that would leave nothing to play.
   */
  set(ids: string[]): { ok: true } | { ok: false; error: string } {
    const KNOWN = known();
    const unknown = ids.filter((id) => !KNOWN.has(id));
    if (unknown.length > 0) return { ok: false, error: `unknown game or variant: ${unknown.join(', ')}` };
    const next = new Set(ids);
    const left = ALL_PLAYABLES.filter((p) => !next.has(p.id) && !next.has(p.game));
    if (left.length === 0) return { ok: false, error: 'at least one game must stay enabled' };
    this.disabled = next;
    this.persist();
    return { ok: true };
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private persist(): void {
    if (!this.file) return;
    const file = this.file;
    const body = JSON.stringify(this.list());
    this.writing = this.writing
      .then(async () => {
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('[party-game] could not save catalog state', err));
  }
}
