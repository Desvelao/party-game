// Live view over the companion's configuration, like the game server's admin Config tab (src/core/server/admin/
// runtimeConfig.ts): changes are validated all-or-nothing against the same schema, applied in place to the shared
// config object (the watcher, manager, router and HTTP layer read it on every use) and kept in a small JSON file
// in dataDir so they survive a restart.
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAPS, SETTINGS, appliesEmbedded, checkMap, checkValue, getAt, key, setAt, type CompanionConfig, type MapDef, type Scalar, type SettingDef } from './settings';

export type RuntimeValue = Scalar | Record<string, string | number>;

interface Tunable {
  key: string;
  path: string[];
  def?: SettingDef;
  map?: MapDef;
}

const tunables = (embedded: boolean): Tunable[] => [
  ...SETTINGS.filter((d) => d.live && (!embedded || appliesEmbedded(d.path))).map((d) => ({ key: key(d.path), path: d.path, def: d })),
  ...MAPS.map((m) => ({ key: key(m.path), path: m.path, map: m })),
];

export interface GameLevels {
  id: string;
  levels: string[];
  policies: string[];
}

export class RuntimeConfig {
  private readonly defaults: Record<string, RuntimeValue>;
  private overrides: Record<string, RuntimeValue> = {};
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string | null;
  private readonly TUNABLES: Tunable[];
  private readonly BY_KEY: Map<string, Tunable>;

  constructor(
    private readonly cfg: CompanionConfig,
    dataDir: string | null,
    /** games with an AI: used to validate level and policy names */
    private readonly games: () => GameLevels[] = () => [],
    private readonly onChange: () => void = () => {},
    /** inside a game server: leave out the settings that only a bot server of its own has */
    private readonly embedded = false,
  ) {
    this.TUNABLES = tunables(embedded);
    this.BY_KEY = new Map(this.TUNABLES.map((t) => [t.key, t]));
    this.file = dataDir ? join(dataDir, 'runtime-config.json') : null;
    this.defaults = this.read();
    if (this.file) {
      try {
        const data = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
        const { values } = this.validate(data);
        this.overrides = values;
        this.apply();
      } catch {
        /* no file yet, or unreadable: run with the configured values */
      }
    }
  }

  private read(): Record<string, RuntimeValue> {
    return Object.fromEntries(this.TUNABLES.map((t) => [t.key, structuredClone(getAt(this.cfg, t.path)) as RuntimeValue]));
  }

  private apply(): void {
    const target = this.cfg as unknown as Record<string, unknown>;
    for (const t of this.TUNABLES) setAt(target, t.path, structuredClone(t.key in this.overrides ? this.overrides[t.key] : this.defaults[t.key]));
    this.onChange();
  }

  private validate(input: Record<string, unknown>): { values: Record<string, RuntimeValue>; errors: Record<string, string> } {
    const values: Record<string, RuntimeValue> = {};
    const errors: Record<string, string> = {};
    const games = this.games();
    for (const [k, v] of Object.entries(input)) {
      const t = this.BY_KEY.get(k);
      if (!t) {
        errors[k] = SETTINGS.some((d) => key(d.path) === k) ? 'needs a restart' : 'unknown setting';
        continue;
      }
      try {
        if (t.def) {
          const value = checkValue(t.def, v);
          if (k === 'ai.level' && value !== 'random' && !games.some((g) => g.levels.includes(String(value)))) throw new Error(`unknown level (${['random', ...new Set(games.flatMap((g) => g.levels))].join(', ')})`);
          values[k] = value;
        } else if (t.map) {
          const map = checkMap(t.map, v);
          for (const [game, name] of Object.entries(map)) {
            const g = games.find((x) => x.id === game);
            if (t.map.kind === 'numbers') continue;
            if (!g) throw new Error(`no AI for ${game}`);
            const allowed = k === 'ai.levels' ? [...g.levels, 'random'] : g.policies;
            if (!allowed.includes(String(name))) throw new Error(`${game}: ${name} is not one of ${allowed.join(', ')}`);
          }
          values[k] = map;
        }
      } catch (e) {
        errors[k] = (e as Error).message;
      }
    }
    return { values, errors };
  }

  /** Apply a partial update, all or nothing. `null` for a key returns it to its configured value. */
  patch(input: Record<string, unknown>): { ok: true } | { ok: false; errors: Record<string, string> } {
    const resets = Object.entries(input).filter(([, v]) => v === null).map(([k]) => k);
    const rest = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null));
    const { values, errors } = this.validate(rest);
    for (const k of resets) if (!this.BY_KEY.has(k)) errors[k] = 'unknown setting';
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    for (const k of resets) delete this.overrides[k];
    Object.assign(this.overrides, values);
    this.apply();
    this.persist();
    return { ok: true };
  }

  reset(): void {
    this.overrides = {};
    this.apply();
    this.persist();
  }

  snapshot() {
    const secret = new Set(SETTINGS.filter((d) => d.secret).map((d) => key(d.path)));
    return {
      values: this.read(),
      defaults: this.defaults,
      overridden: Object.keys(this.overrides),
      ranges: Object.fromEntries(
        this.TUNABLES.map((t) => [t.key, t.def ? { type: t.def.type, min: t.def.min, max: t.def.max, values: t.def.values, maxLength: t.def.maxLength, help: t.def.help } : { type: t.map!.kind === 'numbers' ? 'numbers' : 'map', help: t.map!.help }]),
      ),
      games: this.games(),
      restartOnly: Object.fromEntries(
        SETTINGS.filter((d) => !d.live && (!this.embedded || appliesEmbedded(d.path))).map((d) => {
          const k = key(d.path);
          const v = getAt(this.cfg, d.path);
          return [k, secret.has(k) ? (v ? '(set)' : '(unset)') : v];
        }),
      ),
    };
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private persist(): void {
    if (!this.file) return;
    const file = this.file;
    const body = JSON.stringify(this.overrides, null, 2);
    this.writing = this.writing
      .then(async () => {
        mkdirSync(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('[bots] could not save runtime config', err));
  }
}
