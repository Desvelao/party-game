import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateDefaults, validatePlaylists, type DefaultOverrides, type OperatorPlaylist } from '../shared';
import { SETTINGS, type ConfigOverrides, type SettingDef } from './config';

/** Fixed location used when neither the flag nor the environment variable names a file. */
export const DEFAULT_CONFIG_PATH = '/etc/party-game/config.yaml';
export const CONFIG_ENV_VAR = 'PARTY_GAME_CONFIG';

/** A problem with the command line or the config file: reported as one line, no stack. */
export class ConfigError extends Error {
  constructor(
    message: string,
    /** process exit code: 1 = bad configuration, 2 = bad command line */
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export interface CliArgs {
  config?: string;
  help: boolean;
}

export const USAGE = `Usage: node dist/server.js [-c <file>]

Options:
  -c, --config <file>   YAML configuration file
  -h, --help            show this help

Config file lookup: --config, then $${CONFIG_ENV_VAR}, then ${DEFAULT_CONFIG_PATH} (if it exists).
Settings in the file override environment variables, which override the hardware profile.`;

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-c' || a === '--config') {
      const v = argv[++i];
      if (v === undefined || v === '' || v.startsWith('-')) throw new ConfigError(`${a} needs a file path`, 2);
      out.config = v;
    } else if (a.startsWith('--config=')) {
      const v = a.slice('--config='.length);
      if (!v) throw new ConfigError('--config needs a file path', 2);
      out.config = v;
    } else throw new ConfigError(`unknown argument "${a}" (try --help)`, 2);
  }
  return out;
}

export interface ResolvedConfigPath {
  path: string;
  source: 'flag' | 'env' | 'default';
}

/**
 * flag > $PARTY_GAME_CONFIG > the fixed location. A named file (flag or variable) must exist;
 * the fixed location is only used when present. Returns null when there is no file at all.
 */
export function resolveConfigPath(
  args: Pick<CliArgs, 'config'>,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  fallback: string = DEFAULT_CONFIG_PATH,
): ResolvedConfigPath | null {
  const named = args.config
    ? ({ path: args.config, source: 'flag' } as const)
    : env[CONFIG_ENV_VAR]
      ? ({ path: env[CONFIG_ENV_VAR]!, source: 'env' } as const)
      : null;
  if (named) {
    if (!exists(named.path)) throw new ConfigError(`config file not found: ${named.path} (from ${named.source === 'flag' ? '--config' : CONFIG_ENV_VAR})`);
    return named;
  }
  return exists(fallback) ? { path: fallback, source: 'default' } : null;
}

function checkValue(file: string, def: SettingDef, value: unknown): string | number | boolean {
  const name = def.path.join('.');
  const bad = (why: string) => new ConfigError(`${file}: ${name} ${why}`);
  switch (def.type) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw bad(`must be an integer (got ${JSON.stringify(value)})`);
      if (value < (def.min ?? -Infinity) || value > (def.max ?? Infinity)) throw bad(`must be between ${def.min} and ${def.max} (got ${value})`);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw bad(`must be true or false (got ${JSON.stringify(value)})`);
      return value;
    case 'enum': {
      const v = typeof value === 'string' ? value : '';
      const match = def.values?.find((x) => x.toLowerCase() === v.toLowerCase());
      if (!match) throw bad(`must be one of ${def.values?.join(', ')} (got ${JSON.stringify(value)})`);
      return match;
    }
    case 'string':
      if (typeof value !== 'string') throw bad(`must be a string (got ${JSON.stringify(value)})`);
      if (def.maxLength !== undefined && value.length > def.maxLength) throw bad(`must be at most ${def.maxLength} characters (got ${value.length})`);
      return value;
  }
}

/** Parse and strictly validate a config document (already read from `file`). */
export function parseConfigText(text: string, file = 'config'): ConfigOverrides {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ConfigError(`${file}: invalid YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  if (doc === null || doc === undefined) return {}; // empty file
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new ConfigError(`${file}: the top level must be a mapping of namespaces`);

  const { games: _games, plugins: _plugins, ...rest } = doc as Record<string, unknown>;
  gameSectionOf(_games, file); // validated here so a bad value stops startup like any other
  const out: ConfigOverrides = {};
  walk(rest, [], file, out);
  pluginsSectionOf(_plugins, file, out);
  return out;
}

/** What the `plugins:` section holds besides the three server-level keys: settings per plugin id (checked against each manifest when it loads). */
export interface PluginsSection {
  settings: Record<string, Record<string, unknown>>;
}

const ID_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `plugins:` holds `dir`, `bundledDir`, `enabled` (all | none | a list of ids) and one mapping of settings per plugin id. */
function pluginsSectionOf(plugins: unknown, file: string, out: ConfigOverrides = {}): PluginsSection {
  const section: PluginsSection = { settings: {} };
  if (plugins === null || plugins === undefined) return section;
  if (typeof plugins !== 'object' || Array.isArray(plugins)) throw new ConfigError(`${file}: "plugins" must be a mapping`);
  for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (key === 'dir' || key === 'bundledDir') {
      if (typeof value !== 'string') throw new ConfigError(`${file}: plugins.${key} must be a string`);
      out[key === 'dir' ? 'pluginsDir' : 'bundledPluginsDir'] = value;
    } else if (key === 'enabled') {
      const list = typeof value === 'string' ? value : Array.isArray(value) && value.every((v) => typeof v === 'string' && ID_KEY.test(v)) ? value.join(',') : null;
      if (list === null) throw new ConfigError(`${file}: plugins.enabled must be all, none or a list of plugin ids`);
      out.pluginsEnabled = list;
    } else if (ID_KEY.test(key)) {
      if (typeof value !== 'object' || Array.isArray(value)) throw new ConfigError(`${file}: plugins.${key} must be a mapping of settings`);
      section.settings[key] = value as Record<string, unknown>;
    } else throw new ConfigError(`${file}: unknown setting "plugins.${key}" (expected dir, bundledDir, enabled or a plugin id)`);
  }
  return section;
}

/** The `plugins` settings per plugin id from the config text (empty when there are none). */
export function loadPluginsSection(path: string): PluginsSection {
  const text = readConfigText(path);
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ConfigError(`${path}: invalid YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { settings: {} };
  return pluginsSectionOf((doc as Record<string, unknown>).plugins, path);
}

/** What the `games:` section holds: option defaults and operator playlists. */
export interface GamesSection {
  defaults: DefaultOverrides;
  playlists: OperatorPlaylist[];
}

/** The `games` section: `defaults` ({ game or variant id: { option id: value } }) and `playlists`. */
function gameSectionOf(games: unknown, file: string): GamesSection {
  if (games === null || games === undefined) return { defaults: {}, playlists: [] };
  if (typeof games !== 'object' || Array.isArray(games)) throw new ConfigError(`${file}: "games" must be a mapping`);
  const { defaults, playlists, ...extra } = games as Record<string, unknown>;
  const unknown = Object.keys(extra);
  if (unknown.length > 0) throw new ConfigError(`${file}: unknown setting "games.${unknown[0]}" (expected defaults, playlists)`);
  const d = validateDefaults(defaults);
  if (d.errors.length > 0) throw new ConfigError(`${file}: games.defaults: ${d.errors[0]}`);
  const p = validatePlaylists(playlists);
  if (p.errors.length > 0) throw new ConfigError(`${file}: games.playlists: ${p.errors[0]}`);
  return { defaults: d.value, playlists: p.value };
}

/** The `games` section of the config text (empty when there is none). */
export function parseGamesSection(text: string, file = 'config'): GamesSection {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ConfigError(`${file}: invalid YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { defaults: {}, playlists: [] };
  return gameSectionOf((doc as Record<string, unknown>).games, file);
}

/** Operator defaults of game/variant options from the config text (empty when there are none). */
export function parseGameDefaults(text: string, file = 'config'): DefaultOverrides {
  return parseGamesSection(text, file).defaults;
}

/** Namespaces (groups) known at a path prefix, and whether a setting lives exactly there. */
function childrenAt(prefix: string[]): { groups: Set<string>; keys: Map<string, SettingDef> } {
  const groups = new Set<string>();
  const keys = new Map<string, SettingDef>();
  for (const def of SETTINGS) {
    if (def.path.length <= prefix.length) continue;
    if (!prefix.every((seg, i) => def.path[i] === seg)) continue;
    const next = def.path[prefix.length];
    if (def.path.length === prefix.length + 1) keys.set(next, def);
    else groups.add(next);
  }
  return { groups, keys };
}

function walk(node: Record<string, unknown>, prefix: string[], file: string, out: ConfigOverrides): void {
  const { groups, keys } = childrenAt(prefix);
  for (const [name, value] of Object.entries(node)) {
    const dotted = [...prefix, name].join('.');
    const def = keys.get(name);
    if (def) {
      if (value === null || value === undefined) continue;
      const checked = checkValue(file, def, value);
      (out as Record<string, unknown>)[def.field] = typeof checked === 'number' && def.scale ? checked * def.scale : checked;
    } else if (groups.has(name)) {
      if (value === null || value === undefined) continue; // "server:" with nothing under it
      if (typeof value !== 'object' || Array.isArray(value)) throw new ConfigError(`${file}: "${dotted}" must be a mapping`);
      walk(value as Record<string, unknown>, [...prefix, name], file, out);
    } else {
      const known = [...groups, ...keys.keys()];
      const where = prefix.length ? `setting "${dotted}"` : `section "${name}"`;
      throw new ConfigError(`${file}: unknown ${where} (expected ${prefix.length ? 'one of ' : ''}${known.join(', ')})`);
    }
  }
}

function readConfigText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read config file ${path}: ${(err as Error).message}`);
  }
}

export function loadConfigFile(path: string): ConfigOverrides {
  return parseConfigText(readConfigText(path), path);
}

export function loadGamesSection(path: string): GamesSection {
  return parseGamesSection(readConfigText(path), path);
}
