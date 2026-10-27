import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { SETTINGS, cleanBrandText, type ServerConfig } from '../config';

/** Settings an operator may change while the server runs; everything else needs a restart. */
export const TUNABLE = [
  'maxRooms',
  'maxPlayersPerRoom',
  'maxSpectatorsPerRoom',
  'idleRoomSeconds',
  'idleWarnSeconds',
  'hostIdleSeconds',
  'reconnectGraceSeconds',
  'maxConnectionsPerIp',
  'joinTimeoutMs',
] as const;
/** Boolean settings an operator may flip while the server runs (none today). */
export const TUNABLE_BOOL = [] as const;
/** Text settings (branding) an operator may change while the server runs. */
export const TUNABLE_STR = ['brandName', 'welcomeMessage'] as const;
export type TunableField = (typeof TUNABLE)[number] | (typeof TUNABLE_BOOL)[number] | (typeof TUNABLE_STR)[number];
const isBool = (f: string): boolean => (TUNABLE_BOOL as readonly string[]).includes(f);
const isStr = (f: string): boolean => (TUNABLE_STR as readonly string[]).includes(f);
const ALL_TUNABLE: readonly string[] = [...TUNABLE, ...TUNABLE_BOOL, ...TUNABLE_STR];

/** Shown read-only next to the tunable ones. */
const RESTART_ONLY = ['profile', 'host', 'port', 'tickRate', 'networkRate', 'pingIntervalMs', 'profileStore', 'trustProxy'] as const;

interface Range {
  min: number;
  max: number;
}

/** Longest value of a text setting, from the config-file schema. */
function maxLengthOf(field: TunableField): number {
  const def = SETTINGS.find((s) => s.field === field);
  if (!def || def.maxLength === undefined) throw new Error(`no max length for ${field}`);
  return def.maxLength;
}

/** Ranges in ServerConfig units, derived from the config-file schema (single source of truth). */
function rangeOf(field: TunableField): Range {
  if (isBool(field)) return { min: 0, max: 1 };
  if (isStr(field)) return { min: 0, max: maxLengthOf(field) };
  const def = SETTINGS.find((s) => s.field === field);
  if (!def || def.min === undefined || def.max === undefined) throw new Error(`no range for ${field}`);
  const scale = def.scale ?? 1;
  return { min: def.min * scale, max: def.max * scale };
}

export type RuntimeValues = Record<TunableField, number | boolean | string>;

/**
 * Live view over the server's config. Changes are applied in place to the shared `cfg` object
 * (rooms and the connection handler read it on every use) and kept in a small JSON file so they
 * survive a restart. Values are in `ServerConfig` units (milliseconds for `joinTimeoutMs`).
 */
export class RuntimeConfig {
  private readonly defaults: RuntimeValues;
  private overrides: Partial<RuntimeValues> = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly cfg: ServerConfig,
    private readonly file: string | null = null,
    private readonly onChange: () => void = () => {},
  ) {
    this.defaults = this.read();
    if (file) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        const { values } = this.validate(data);
        this.overrides = values;
        this.apply();
      } catch {
        /* no file yet, or unreadable: run with the configured values */
      }
    }
  }

  private read(): RuntimeValues {
    return Object.fromEntries(ALL_TUNABLE.map((f) => [f, this.cfg[f as TunableField]])) as RuntimeValues;
  }

  private apply(): void {
    Object.assign(this.cfg, this.defaults, this.overrides);
    this.onChange();
  }

  private validate(input: Record<string, unknown>): { values: Partial<RuntimeValues>; errors: Record<string, string> } {
    const values: Partial<RuntimeValues> = {};
    const errors: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      if (!ALL_TUNABLE.includes(k)) {
        errors[k] = (RESTART_ONLY as readonly string[]).includes(k) ? 'needs a restart' : 'unknown setting';
        continue;
      }
      const field = k as TunableField;
      if (isStr(field)) {
        if (typeof v !== 'string') {
          errors[k] = 'must be text';
          continue;
        }
        const max = maxLengthOf(field);
        const text = cleanBrandText(v, Number.MAX_SAFE_INTEGER);
        if (text.length > max) errors[k] = `must be at most ${max} characters`;
        else if (field === 'brandName' && text === '') errors[k] = 'must not be empty';
        else values[field] = text;
        continue;
      }
      if (isBool(field)) {
        if (typeof v === 'boolean') values[field] = v;
        else errors[k] = 'must be true or false';
        continue;
      }
      const { min, max } = rangeOf(field);
      if (typeof v !== 'number' || !Number.isInteger(v)) errors[k] = 'must be an integer';
      else if (v < min || v > max) errors[k] = `must be between ${min} and ${max}`;
      else values[field] = v;
    }
    return { values, errors };
  }

  /** Apply a partial update, all or nothing. `null` for a field returns it to its configured value. */
  patch(input: Record<string, unknown>): { ok: true } | { ok: false; errors: Record<string, string> } {
    const resets = Object.entries(input).filter(([, v]) => v === null).map(([k]) => k);
    const rest = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null));
    const { values, errors } = this.validate(rest);
    for (const k of resets) {
      if (!ALL_TUNABLE.includes(k)) errors[k] = 'unknown setting';
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    for (const k of resets) delete this.overrides[k as TunableField];
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
    return {
      values: this.read(),
      defaults: this.defaults,
      overridden: Object.keys(this.overrides),
      ranges: Object.fromEntries(ALL_TUNABLE.map((f) => [f, rangeOf(f as TunableField)])),
      restartOnly: Object.fromEntries(RESTART_ONLY.map((f) => [f, this.cfg[f]])),
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
        await writeFile(`${file}.tmp`, body);
        await rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error('[party-game] could not save runtime config', err));
  }
}
