/**
 * Validation of a plugin's `plugin.json`, and of the version ranges plugins use. Pure (no Node APIs).
 */
import { validateCharacterDefs } from './character';
import { isPackLocales } from './i18n';
import { ID_RE } from './manifest';
import { PLUGIN_CAPABILITIES, PLUGIN_FILES, SUPPORTED_PLUGIN_API_VERSIONS, type PluginManifest, type PluginOption } from './plugins';

const OPTION_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SEMVER_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RANGE_RE = /^(?:(?:>=|<=|>|<|=)?\d{1,6}\.\d{1,6}\.\d{1,6})(?: (?:(?:>=|<=|>|<|=)?\d{1,6}\.\d{1,6}\.\d{1,6}))*$/;
const MAX_TEXT = 600;

/** Ids a plugin may not take: its API lives under `/api/<id>/`, which must never shadow a core route. A new core `/api/<namespace>` must be added here. */
export const RESERVED_PLUGIN_IDS: readonly string[] = ['admin', 'profile', 'catalog', 'games', 'plugins', 'ws', 'stats', 'rooms', 'status', 'manifest'];

/** First path segments a plugin may not claim as a root route (they belong to the core, the games or the plugin namespaces). */
export const RESERVED_ROOT_ROUTES: readonly string[] = ['/api', '/plugins', '/games', '/admin', '/stats', '/status', '/rooms', '/ws', '/manifest.webmanifest', '/assets', '/health', '/profile', '/room'];
const ROOT_ROUTE_RE = /^\/[a-z0-9][a-z0-9.-]{0,31}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 2 && v.length <= 32 && ID_RE.test(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const cmp = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** Does `version` satisfy `range`? A range is comparators joined by spaces (all must hold): ">=1.0.0 <2.0.0", "1.2.3" (exact). */
export function satisfies(version: string, range: string): boolean {
  if (!RANGE_RE.test(range) || !SEMVER_RE.test(version)) return false;
  return range.split(' ').every((part) => {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(part)!;
    const c = cmp(version, m[2]);
    switch (m[1]) {
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  });
}

export const isRange = (v: unknown): v is string => typeof v === 'string' && RANGE_RE.test(v);

function option(o: unknown, at: string, seen: Set<string>, errs: string[]): void {
  if (!isObj(o)) return void errs.push(`${at} must be an object`);
  if (typeof o.id !== 'string' || !OPTION_ID_RE.test(o.id)) errs.push(`${at}.id must be letters and digits, starting with a letter`);
  else if (seen.has(o.id)) errs.push(`${at}.id "${o.id}" is repeated`);
  else seen.add(o.id);
  if (!isStr(o.label, 80)) errs.push(`${at}.label is required`);
  if (!isStr(o.description)) errs.push(`${at}.description is required`);
  if (o.env !== undefined && !(typeof o.env === 'string' && ENV_RE.test(o.env))) errs.push(`${at}.env must be an environment variable name like MY_SETTING`);
  if (o.secret !== undefined && typeof o.secret !== 'boolean') errs.push(`${at}.secret must be true or false`);
  switch (o.type) {
    case 'number':
      if (!isNum(o.default)) errs.push(`${at}.default must be a number`);
      for (const k of ['min', 'max'] as const) if (o[k] !== undefined && !isNum(o[k])) errs.push(`${at}.${k} must be a number`);
      break;
    case 'boolean':
      if (typeof o.default !== 'boolean') errs.push(`${at}.default must be true or false`);
      break;
    case 'string':
      if (typeof o.default !== 'string') errs.push(`${at}.default must be text`);
      break;
    case 'choice': {
      const c = o.choices;
      if (!Array.isArray(c) || c.length === 0 || c.length > 24 || !c.every((x) => isObj(x) && isStr(x.value, 40) && isStr(x.label, 80))) errs.push(`${at}.choices must be a list of { value, label }`);
      else if (!c.some((x) => (x as { value: string }).value === o.default)) errs.push(`${at}.default must be one of the choices`);
      break;
    }
    default:
      errs.push(`${at}.type must be number, boolean, string or choice`);
  }
}

export type PluginManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

/** Check an already-parsed `plugin.json`. Collects every problem rather than stopping at the first. */
export function validatePluginManifest(raw: unknown): PluginManifestResult {
  const errs: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['plugin.json must be a JSON object'] };
  if (raw.kind !== 'plugin') errs.push('kind must be "plugin"');
  if (!isId(raw.id)) errs.push('id must be a lowercase id like "my-plugin" (2-32 characters)');
  else if (RESERVED_PLUGIN_IDS.includes(raw.id)) errs.push(`id "${raw.id}" is reserved (plugin endpoints live under /api/<id>/)`);
  if (!isStr(raw.name, 60)) errs.push('name is required');
  if (typeof raw.version !== 'string' || !SEMVER_RE.test(raw.version)) errs.push('version must look like 1.2.3');
  if (typeof raw.apiVersion !== 'number' || !SUPPORTED_PLUGIN_API_VERSIONS.includes(raw.apiVersion)) errs.push(`apiVersion is ${String(raw.apiVersion)} but this server supports ${SUPPORTED_PLUGIN_API_VERSIONS.join(' and ')}`);
  if (!isStr(raw.author, 80)) errs.push('author is required');
  if (!isStr(raw.license, 40)) errs.push('license is required');
  if (!isStr(raw.description)) errs.push('description is required');
  if (raw.order !== undefined && !(Number.isInteger(raw.order) && (raw.order as number) >= 0 && (raw.order as number) <= 10_000)) errs.push('order must be a whole number from 0 to 10000');
  if (raw.requires !== undefined) {
    if (!isObj(raw.requires) || Object.keys(raw.requires).length > 16) errs.push('requires must map plugin ids to version ranges');
    else for (const [id, range] of Object.entries(raw.requires)) if (!isId(id) || !isRange(range)) errs.push(`requires["${id}"] must be a version range like ">=1.0.0"`);
  }
  if (raw.engines !== undefined) {
    if (!isObj(raw.engines) || (raw.engines.core !== undefined && !isRange(raw.engines.core))) errs.push('engines.core must be a version range like ">=1.0.0"');
  }
  if (raw.config !== undefined) {
    if (!Array.isArray(raw.config) || raw.config.length > 64) errs.push('config must be a list of at most 64 options');
    else {
      const seen = new Set<string>();
      raw.config.forEach((o, i) => option(o, `config[${i}]`, seen, errs));
    }
  }
  if (raw.capabilities !== undefined) {
    const c = raw.capabilities;
    if (!Array.isArray(c) || c.length > PLUGIN_CAPABILITIES.length || !c.every((x) => (PLUGIN_CAPABILITIES as readonly unknown[]).includes(x))) errs.push(`capabilities must be a list of: ${PLUGIN_CAPABILITIES.join(', ')}`);
  }
  if (raw.rootRoutes !== undefined) {
    const r = raw.rootRoutes;
    if (!Array.isArray(r) || r.length > 8 || !r.every((x) => typeof x === 'string' && ROOT_ROUTE_RE.test(x) && !RESERVED_ROOT_ROUTES.includes(x))) errs.push('rootRoutes must be a list of at most 8 top-level paths like "/metrics" (not one the server already uses)');
  }
  if (raw.clientRoutes !== undefined) {
    const r = raw.clientRoutes;
    if (!Array.isArray(r) || r.length > 4 || !r.every((x) => typeof x === 'string' && ROOT_ROUTE_RE.test(x) && !RESERVED_ROOT_ROUTES.includes(x))) errs.push('clientRoutes must be a list of at most 4 top-level paths like "/leaderboard" (not one the server already uses)');
  }
  validateCharacterDefs(raw.characters, 'characters', errs);
  if (raw.locales !== undefined && !isPackLocales(raw.locales, 2000, MAX_TEXT)) {
    errs.push('locales must be { es: { "English text": "Texto" }, fr: {...}, de: {...}, pt: {...}, it: {...} } (every language is optional)');
  }
  const files = raw.files;
  if (!isObj(files)) errs.push('files must map each shipped file to its sha256');
  else {
    for (const [name, hash] of Object.entries(files)) {
      if (!(PLUGIN_FILES as readonly string[]).includes(name) || name === 'plugin.json') errs.push(`files lists "${name}", which a plugin may not contain`);
      else if (typeof hash !== 'string' || !SHA256_RE.test(hash)) errs.push(`files["${name}"] must be a sha256 hex string`);
    }
    if (!('server.mjs' in files)) errs.push('files must include server.mjs');
  }
  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, manifest: raw as unknown as PluginManifest };
}

export function parsePluginManifest(text: string): PluginManifestResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`plugin.json is not valid JSON (${(err as Error).message})`] };
  }
  return validatePluginManifest(raw);
}

export type { PluginOption };
