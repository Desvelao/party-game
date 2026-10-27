// The bot server's settings: the schema (src/plugins/bots/engine/ops/settings.ts) plus what only a process of its own needs:
// the YAML file, the environment variables, command-line flags and `--check`. Same model as the game server
// (src/core/server/config.ts + configFile.ts): flags > file > environment > default, strict file validation, one-line errors.
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { MAPS, SETTINGS, checkMap, checkValue, defaultConfig, getAt, key, setAt, ConfigError, type CompanionConfig, type Scalar, type SettingDef } from '../../src/plugins/bots/engine/ops/settings';

export * from '../../src/plugins/bots/engine/ops/settings';

// ---- config file ------------------------------------------------------------------------------------------------

export const CONFIG_ENV_VAR = 'BOT_SERVER_CONFIG';
export const DEFAULT_CONFIG_PATH = '/etc/party-game/bot-server.yaml';

export interface FileValues {
  scalars: Map<string, Scalar>;
  maps: Map<string, Record<string, string | number>>;
}

/** Parse and strictly validate a config document (already read from `file`). */
export function parseConfigText(text: string, file = 'config'): FileValues {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ConfigError(`${file}: invalid YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  const out: FileValues = { scalars: new Map(), maps: new Map() };
  if (doc === null || doc === undefined) return out;
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new ConfigError(`${file}: the top level must be a mapping of namespaces`);

  const known = new Set<string>([...SETTINGS.map((d) => key(d.path)), ...MAPS.map((m) => key(m.path))]);
  const walk = (node: Record<string, unknown>, prefix: string[]): void => {
    for (const [k, v] of Object.entries(node)) {
      const path = [...prefix, k];
      const name = key(path);
      if (known.has(name)) continue;
      if (![...known].some((n) => n.startsWith(name + '.'))) throw new ConfigError(`${file}: unknown setting "${name}"`);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ConfigError(`${file}: ${name} must be a mapping`);
      walk(v as Record<string, unknown>, path);
    }
  };
  walk(doc as Record<string, unknown>, []);

  for (const d of SETTINGS) {
    const v = getAt(doc, d.path);
    if (v === undefined) continue;
    try {
      out.scalars.set(key(d.path), checkValue(d, v));
    } catch (e) {
      throw new ConfigError(`${file}: ${key(d.path)} ${(e as Error).message}`);
    }
  }
  for (const m of MAPS) {
    const v = getAt(doc, m.path);
    if (v === undefined) continue;
    try {
      out.maps.set(key(m.path), checkMap(m, v));
    } catch (e) {
      throw new ConfigError(`${file}: ${key(m.path)} ${(e as Error).message}`);
    }
  }
  return out;
}

export function loadConfigFile(path: string): FileValues {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read ${path}: ${(err as Error).message}`);
  }
  return parseConfigText(text, path);
}

export interface CliArgs {
  config?: string;
  help: boolean;
  check: boolean;
  /** convenience overrides (highest precedence): setting key -> raw value */
  flags: Map<string, string>;
  /** boolean flags: --no-reports, --no-metrics, --mixed */
  switches: Map<string, boolean | string>;
}

export const USAGE = `Usage: npm run bot:server -- [-c <file>] [--check]     (built: node dist/bot-main.js ...)

Options:
  -c, --config <file>   YAML configuration file
      --check           validate the configuration, print every effective value and where it came from, then exit
  -h, --help            show this help

Config file lookup: --config, then $${CONFIG_ENV_VAR}, then ${DEFAULT_CONFIG_PATH} (if it exists).
Settings in the file override environment variables, which override the defaults. Every setting has an
environment variable (see bot/server/config.example.yaml). The admin token is ADMIN_TOKEN.

Extra flags (not in the game server; they beat the file and the environment):
${SETTINGS.filter((d) => d.flag).map((d) => `  ${(d.flag + ' <v>').padEnd(22)}${key(d.path)}`).join('\n')}
  ${'--no-reports'.padEnd(22)}reports.enabled = false
  ${'--no-metrics'.padEnd(22)}metrics.enabled = false
  ${'--mixed'.padEnd(22)}ai.mixed = always`;

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false, check: false, flags: new Map(), switches: new Map() };
  const flagDefs = new Map(SETTINGS.filter((d) => d.flag).map((d) => [d.flag!, d]));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--check') out.check = true;
    else if (a === '-c' || a === '--config') {
      const v = argv[++i];
      if (v === undefined || v === '' || v.startsWith('-')) throw new ConfigError(`${a} needs a file path`, 2);
      out.config = v;
    } else if (a.startsWith('--config=')) {
      const v = a.slice('--config='.length);
      if (!v) throw new ConfigError('--config needs a file path', 2);
      out.config = v;
    } else if (a === '--no-reports') out.switches.set('reports.enabled', false);
    else if (a === '--no-metrics') out.switches.set('metrics.enabled', false);
    else if (a === '--mixed') out.switches.set('ai.mixed', 'always');
    else if (flagDefs.has(a)) {
      const v = argv[++i];
      if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new ConfigError(`${a} needs a value`, 2);
      out.flags.set(key(flagDefs.get(a)!.path), v);
    } else throw new ConfigError(`unknown argument "${a}" (try --help)`, 2);
  }
  return out;
}

export interface ResolvedConfigPath {
  path: string;
  source: 'flag' | 'env' | 'default';
}

/** flag > $BOT_SERVER_CONFIG > the fixed location. A named file must exist; the fixed one is optional. */
export function resolveConfigPath(
  args: Pick<CliArgs, 'config'>,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  fallback: string = DEFAULT_CONFIG_PATH,
): ResolvedConfigPath | null {
  const named = args.config ? ({ path: args.config, source: 'flag' } as const) : env[CONFIG_ENV_VAR] ? ({ path: env[CONFIG_ENV_VAR]!, source: 'env' } as const) : null;
  if (named) {
    if (!exists(named.path)) throw new ConfigError(`config file not found: ${named.path} (from ${named.source === 'flag' ? '--config' : CONFIG_ENV_VAR})`);
    return named;
  }
  return exists(fallback) ? { path: fallback, source: 'default' } : null;
}

// ---- assembling the effective configuration ---------------------------------------------------------------------

export type Source = 'flag' | 'file' | 'env' | 'default';

export interface Resolved {
  cfg: CompanionConfig;
  sources: Map<string, Source>;
  warnings: string[];
}

function envValue(def: SettingDef, env: NodeJS.ProcessEnv, warn: (m: string) => void): Scalar | undefined {
  for (const name of def.env) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') continue;
    if (name !== def.env[0]) warn(`${name} is deprecated, use ${def.env[0]}`);
    const t = raw.trim();
    switch (def.type) {
      case 'int': {
        if (!/^[+-]?\d+$/.test(t)) {
          warn(`ignoring ${name}=${JSON.stringify(raw)}: not an integer`);
          continue;
        }
        const n = Number.parseInt(t, 10);
        const c = Math.min(def.max ?? n, Math.max(def.min ?? n, n));
        if (c !== n) warn(`${name}=${n} is outside ${def.min}..${def.max}, using ${c}`);
        return c;
      }
      case 'bool': {
        const v = t.toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(v)) return true;
        if (['0', 'false', 'no', 'off'].includes(v)) return false;
        warn(`ignoring ${name}=${JSON.stringify(raw)}: expected 1/true/yes or 0/false/no`);
        continue;
      }
      case 'enum': {
        const m = def.values?.find((x) => x.toLowerCase() === t.toLowerCase());
        if (!m) {
          warn(`ignoring ${name}=${JSON.stringify(raw)}: expected ${def.values?.join(' | ')}`);
          continue;
        }
        return m;
      }
      case 'string':
        return def.maxLength !== undefined ? raw.slice(0, def.maxLength) : raw;
    }
  }
  return undefined;
}

/** flags > file > environment > default */
export function resolveConfig(args: CliArgs, file: FileValues | null, env: NodeJS.ProcessEnv = process.env): Resolved {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const cfg = defaultConfig() as unknown as Record<string, unknown>;
  const sources = new Map<string, Source>();
  for (const d of SETTINGS) {
    const k = key(d.path);
    let value: Scalar = d.default;
    let source: Source = 'default';
    const e = envValue(d, env, warn);
    if (e !== undefined) [value, source] = [e, 'env'];
    const f = file?.scalars.get(k);
    if (f !== undefined) [value, source] = [f, 'file'];
    const raw = args.flags.get(k);
    if (raw !== undefined) {
      try {
        const parsed = d.type === 'int' ? Number(raw) : d.type === 'bool' ? raw === 'true' : raw;
        [value, source] = [checkValue(d, parsed), 'flag'];
      } catch (err) {
        throw new ConfigError(`${d.flag} ${(err as Error).message}`, 2);
      }
    }
    const sw = args.switches.get(k);
    if (sw !== undefined) [value, source] = [sw, 'flag'];
    setAt(cfg, d.path, value);
    sources.set(k, source);
  }
  for (const m of MAPS) {
    const v = file?.maps.get(key(m.path));
    if (v) setAt(cfg, m.path, v);
    sources.set(key(m.path), v ? 'file' : 'default');
  }
  const c = cfg as unknown as CompanionConfig;
  // the game server's admin token defaults to ours (the usual setup: one ADMIN_TOKEN for both)
  if (!c.gameServer.adminToken && c.server.adminToken) {
    c.gameServer.adminToken = c.server.adminToken;
    sources.set('gameServer.adminToken', sources.get('server.adminToken')!);
  }
  return { cfg: c, sources, warnings };
}

/** http(s) base URL -> ws(s) URL of the game socket */
export const wsUrl = (base: string): string => base.replace(/\/+$/, '').replace(/^http/, 'ws') + '/ws';

export function validateConfig(c: CompanionConfig): string[] {
  const e: string[] = [];
  if (!/^https?:\/\//.test(c.gameServer.url)) e.push('gameServer.url must start with http:// or https://');
  const lan = !['127.0.0.1', 'localhost', '::1'].includes(c.server.host);
  if (lan && !c.server.adminToken) e.push('listening beyond loopback needs an admin token (ADMIN_TOKEN / server.adminToken)');
  return e;
}
