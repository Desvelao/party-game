/**
 * Validation of a game pack's `game.json`. Pure (no Node APIs), so the loader, the CLI, the pack
 * tool and the browser can all use it. Packs are untrusted input: every field is checked.
 */
import { ACTION_KINDS, GAME_TAGS, isGameTag } from './catalog';
import { validateCharacterDefs, validateCharacterRef } from './character';
import { TRANSLATED_LANGS, isPackLocales } from './i18n';
import { PACK_API_VERSION, PACK_FILES, type GameManifest } from './plugin-api';

export const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const OPTION_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const SEMVER_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_TEXT = 600;
const MAX_LOCALE_ENTRIES = 2000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 2 && v.length <= 32 && ID_RE.test(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

type Errors = string[];

function localized(v: unknown, path: string, errs: Errors): void {
  if (!isObj(v) || !isStr(v.en) || TRANSLATED_LANGS.some((l) => v[l] !== undefined && !isStr(v[l]))) errs.push(`${path} must be an { en } text with optional translations (${TRANSLATED_LANGS.join(', ')})`);
}

function guide(v: unknown, path: string, errs: Errors): void {
  if (!isObj(v)) return void errs.push(`${path} must be an object`);
  localized(v.objective, `${path}.objective`, errs);
  if (!Array.isArray(v.rules) || v.rules.length > 12) errs.push(`${path}.rules must be a list of at most 12 texts`);
  else v.rules.forEach((r, i) => localized(r, `${path}.rules[${i}]`, errs));
  if (v.items !== undefined) {
    if (!Array.isArray(v.items) || v.items.length > 24) errs.push(`${path}.items must be a list of at most 24 items`);
    else
      v.items.forEach((it, i) => {
        if (!isObj(it)) return void errs.push(`${path}.items[${i}] must be an object`);
        localized(it.name, `${path}.items[${i}].name`, errs);
        localized(it.description, `${path}.items[${i}].description`, errs);
      });
  }
}

function options(v: unknown, path: string, errs: Errors): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > 64) return void errs.push(`${path} must be a list of at most 64 options`);
  const seen = new Set<string>();
  v.forEach((o, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(o)) return void errs.push(`${at} must be an object`);
    if (typeof o.id !== 'string' || !OPTION_ID_RE.test(o.id)) errs.push(`${at}.id must be letters and digits, starting with a letter`);
    else if (seen.has(o.id)) errs.push(`${at}.id "${o.id}" is repeated`);
    else seen.add(o.id);
    if (!isStr(o.label, 80)) errs.push(`${at}.label is required`);
    if (!isStr(o.description)) errs.push(`${at}.description is required`);
    if (o.type === 'number') {
      if (!isNum(o.default)) errs.push(`${at}.default must be a number`);
      for (const k of ['min', 'max', 'step'] as const) if (o[k] !== undefined && !isNum(o[k])) errs.push(`${at}.${k} must be a number`);
    } else if (o.type === 'boolean') {
      if (typeof o.default !== 'boolean') errs.push(`${at}.default must be true or false`);
    } else if (o.type === 'choice') {
      const choices = o.choices;
      if (!Array.isArray(choices) || choices.length === 0 || choices.length > 24 || !choices.every((c) => isObj(c) && isStr(c.value, 40) && isStr(c.label, 80))) {
        errs.push(`${at}.choices must be a list of { value, label }`);
      } else if (!choices.some((c) => (c as { value: string }).value === o.default)) errs.push(`${at}.default must be one of the choices`);
    } else errs.push(`${at}.type must be number, boolean or choice`);
  });
}

function limits(v: Record<string, unknown>, path: string, errs: Errors): void {
  for (const k of ['maxPlayers', 'maxTeamSize'] as const) if (v[k] !== undefined && !(Number.isInteger(v[k]) && (v[k] as number) >= 1 && (v[k] as number) <= 64)) errs.push(`${path}.${k} must be a whole number from 1 to 64`);
  if (v.teams !== undefined && typeof v.teams !== 'boolean') errs.push(`${path}.teams must be true or false`);
}

function tags(v: Record<string, unknown>, path: string, errs: Errors): void {
  if (v.tags === undefined) return;
  if (!Array.isArray(v.tags) || v.tags.length > GAME_TAGS.length || !v.tags.every(isGameTag) || new Set(v.tags).size !== v.tags.length) {
    errs.push(`${path}.tags must be a list of different tags from: ${GAME_TAGS.join(', ')}`);
  }
}

function action(v: Record<string, unknown>, path: string, errs: Errors): void {
  if (!(ACTION_KINDS as readonly unknown[]).includes(v.action)) errs.push(`${path}.action must be one of ${ACTION_KINDS.join(', ')}`);
  if (v.action2 !== undefined && !(ACTION_KINDS as readonly unknown[]).includes(v.action2)) errs.push(`${path}.action2 must be one of ${ACTION_KINDS.join(', ')}`);
}

function catalogGame(v: unknown, errs: Errors): void {
  if (!isObj(v)) return void errs.push('catalog must be an object');
  if (!isId(v.id)) errs.push('catalog.id must be a lowercase id like "my-game"');
  if (!isStr(v.name, 60)) errs.push('catalog.name is required');
  if (!isStr(v.description)) errs.push('catalog.description is required');
  action(v, 'catalog', errs);
  guide(v.guide, 'catalog.guide', errs);
  options(v.options, 'catalog.options', errs);
  if (v.touchHint !== undefined) localized(v.touchHint, 'catalog.touchHint', errs);
  limits(v, 'catalog', errs);
  tags(v, 'catalog', errs);
  if (!Array.isArray(v.variants) || v.variants.length > 32) return void errs.push('catalog.variants must be a list (empty for a game without variants)');
  const ids = new Set<string>([v.id as string]);
  v.variants.forEach((x, i) => {
    const at = `catalog.variants[${i}]`;
    if (!isObj(x)) return void errs.push(`${at} must be an object`);
    if (!isId(x.id)) errs.push(`${at}.id must be a lowercase id`);
    else if (ids.has(x.id)) errs.push(`${at}.id "${x.id}" is repeated`);
    else ids.add(x.id);
    if (!isStr(x.name, 60)) errs.push(`${at}.name is required`);
    if (!isStr(x.description)) errs.push(`${at}.description is required`);
    action(x, at, errs);
    guide(x.guide, `${at}.guide`, errs);
    options(x.options, `${at}.options`, errs);
    limits(x, at, errs);
    tags(x, at, errs);
  });
}

export type ManifestResult = { ok: true; manifest: GameManifest } | { ok: false; errors: string[] };

/** Check an already-parsed `game.json`. Collects every problem rather than stopping at the first. */
export function validateManifest(raw: unknown): ManifestResult {
  const errs: Errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['game.json must be a JSON object'] };
  if (!isId(raw.id)) errs.push('id must be a lowercase id like "my-game" (2-32 characters)');
  if (!isStr(raw.name, 60)) errs.push('name is required');
  if (typeof raw.version !== 'string' || !SEMVER_RE.test(raw.version)) errs.push('version must look like 1.2.3');
  if (raw.apiVersion !== PACK_API_VERSION) errs.push(`apiVersion is ${String(raw.apiVersion)} but this server supports ${PACK_API_VERSION}`);
  if (!isStr(raw.author, 80)) errs.push('author is required');
  if (!isStr(raw.license, 40)) errs.push('license is required');
  if (!isStr(raw.description)) errs.push('description is required');
  if (raw.order !== undefined && !(Number.isInteger(raw.order) && (raw.order as number) >= 0 && (raw.order as number) <= 10_000)) errs.push('order must be a whole number from 0 to 10000');
  catalogGame(raw.catalog, errs);
  if (isObj(raw.catalog) && raw.catalog.id !== raw.id) errs.push('catalog.id must equal id');
  validateCharacterDefs(raw.characters, 'characters', errs);
  validateCharacterRef(raw.character, 'character', errs);
  if (raw.locales !== undefined && !isPackLocales(raw.locales, MAX_LOCALE_ENTRIES, MAX_TEXT)) {
    errs.push('locales must be { es: { "English text": "Texto" }, fr: {...}, de: {...}, pt: {...}, it: {...} } (every language is optional)');
  }
  const files = raw.files;
  if (!isObj(files)) errs.push('files must map each shipped file to its sha256');
  else {
    for (const [name, hash] of Object.entries(files)) {
      if (!(PACK_FILES as readonly string[]).includes(name) || name === 'game.json' || name === 'plugin.json') errs.push(`files lists "${name}", which a pack may not contain`);
      else if (typeof hash !== 'string' || !SHA256_RE.test(hash)) errs.push(`files["${name}"] must be a sha256 hex string`);
    }
    for (const need of ['server.mjs', 'client.mjs']) if (!(need in files)) errs.push(`files must include ${need}`);
  }
  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, manifest: raw as unknown as GameManifest };
}

/** Parse the text of `game.json`, then validate it. */
export function parseManifest(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`game.json is not valid JSON (${(err as Error).message})`] };
  }
  return validateManifest(raw);
}

/** Dotted-number compare of two `x.y.z` versions: <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
