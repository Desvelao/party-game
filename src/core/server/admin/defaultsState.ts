import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { setDefaultOverrides, validateDefaults, type DefaultOverrides, type OptionValue } from '../../shared';

/**
 * Operator-set defaults of game and variant options. Two layers: the config file (read-only here)
 * and admin overrides (persisted in the data dir). Admin wins over the file; resetting an admin
 * value falls back to the file value, then to the built-in default.
 */
export class DefaultsState {
  private admin: DefaultOverrides = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string | null = null,
    private readonly fromFile: DefaultOverrides = {},
  ) {
    if (file) {
      try {
        // unknown ids / invalid values (e.g. after an upgrade changed a range) are dropped, not fatal
        this.admin = validateDefaults(JSON.parse(readFileSync(file, 'utf8'))).value;
      } catch {
        /* no file yet */
      }
    }
    this.apply();
  }

  /** What the games run with: file defaults overlaid by admin overrides. */
  effective(): DefaultOverrides {
    const out: DefaultOverrides = {};
    for (const layer of [this.fromFile, this.admin]) {
      for (const [id, opts] of Object.entries(layer)) out[id] = { ...out[id], ...opts };
    }
    return out;
  }

  layers(): { file: DefaultOverrides; admin: DefaultOverrides; effective: DefaultOverrides } {
    return { file: this.fromFile, admin: this.admin, effective: this.effective() };
  }

  /** Set admin values for one game/variant; a `null` value removes that override. */
  patch(target: string, options: Record<string, OptionValue | null>): { ok: true } | { ok: false; errors: string[] } {
    const set: Record<string, unknown> = {};
    const clear: string[] = [];
    for (const [id, v] of Object.entries(options)) (v === null ? clear.push(id) : (set[id] = v));
    const checked = validateDefaults({ [target]: set });
    if (checked.errors.length > 0) return { ok: false, errors: checked.errors };
    const next: DefaultOverrides = { ...this.admin, [target]: { ...this.admin[target], ...checked.value[target] } };
    for (const id of clear) delete next[target][id];
    if (Object.keys(next[target]).length === 0) delete next[target];
    this.admin = next;
    this.changed();
    return { ok: true };
  }

  /** Drop admin overrides: one target, or all. */
  reset(target?: string): void {
    if (target) {
      const { [target]: _gone, ...rest } = this.admin;
      this.admin = rest;
    } else this.admin = {};
    this.changed();
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private apply(): void {
    setDefaultOverrides(this.effective());
  }

  private changed(): void {
    this.apply();
    if (!this.file) return;
    const file = this.file;
    const body = JSON.stringify(this.admin);
    this.writing = this.writing
      .then(async () => {
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('[party-game] could not save option defaults', err));
  }
}
