/**
 * Minimal i18n, no dependencies: English plus Spanish, French, German, Portuguese and Italian. Game and
 * variant names are never translated. Three kinds of text:
 *  - UI strings: `t('key', params)` looked up in `locales/{en,es,fr,de,pt,it}.ts`
 *  - catalog texts written in English in the data (option labels, descriptions):
 *    `tr(english)` looks the sentence up in `CATALOGS` (core texts) and in the `locales` of the packs
 *  - catalog texts that carry every language (`Localized`, used by guides): `loc(x)`
 * Anything missing in a language falls back to English.
 */
import { EN, type MessageKey } from './locales/en';
export type { MessageKey };
import { CATALOGS, LOCALES } from './locales';

export type Lang = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it';
/** every language but English, the one the texts are written in */
export type TranslatedLang = Exclude<Lang, 'en'>;
/** A text in English plus its translations. Built-in games carry all of them (a test asserts it); a missing one falls back to English. */
export type Localized = { en: string } & Partial<Record<TranslatedLang, string>>;
/** Translations a game pack or plugin ships (`locales` in game.json / plugin.json), keyed by the English sentence. */
export type PackLocales = Partial<Record<TranslatedLang, Record<string, string>>>;

export const TRANSLATED_LANGS: TranslatedLang[] = ['es', 'fr', 'de', 'pt', 'it'];
export const LANGS: Lang[] = ['en', ...TRANSLATED_LANGS];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', it: 'Italiano' };
export const LANG_FLAGS: Record<Lang, string> = {
  en: '\u{1F1EC}\u{1F1E7}',
  es: '\u{1F1EA}\u{1F1F8}',
  fr: '\u{1F1EB}\u{1F1F7}',
  de: '\u{1F1E9}\u{1F1EA}',
  pt: '\u{1F1F5}\u{1F1F9}',
  it: '\u{1F1EE}\u{1F1F9}',
};

const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

/** Shape check of a manifest's `locales` (used by the game pack and plugin manifests). */
export function isPackLocales(v: unknown, maxEntries: number, maxText: number): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.entries(v).every(([lang, texts]) => {
    if (!TRANSLATED_LANGS.includes(lang as TranslatedLang)) return false;
    if (typeof texts !== 'object' || texts === null || Array.isArray(texts)) return false;
    return Object.keys(texts).length <= maxEntries && Object.values(texts).every((x) => typeof x === 'string' && x.length <= maxText);
  });
}

/** localStorage key of the chosen language (public/offline.html and the server pages read the same one) */
export const LANG_KEY = 'party-game:lang';
const DICTS: Record<Lang, Record<string, string>> = { en: EN, ...LOCALES };

function detect(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* no storage (server, private mode) */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  const code = nav.toLowerCase().slice(0, 2);
  return isLang(code) ? code : 'en';
}

let current: Lang = detect();
const listeners = new Set<(lang: Lang) => void>();

function applyDocument(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}
applyDocument();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
  applyDocument();
  listeners.forEach((cb) => cb(lang));
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLangChange(cb: (lang: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** UI string by key, with `{name}` placeholders. Falls back to English, then the key. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = DICTS[current][key] ?? EN[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`)) : text;
}

/** Translate an English sentence that lives in the catalog data. */
export function tr(english: string): string {
  if (current === 'en') return english;
  return CATALOGS[current][english] ?? EXTRA[current].get(english) ?? english;
}

/** Texts shipped by installed game packs and plugins, per language, keyed by their English sentence. */
const EXTRA = Object.fromEntries(TRANSLATED_LANGS.map((l) => [l, new Map<string, string>()])) as Record<TranslatedLang, Map<string, string>>;

/** Add the packs' translations for `tr()` (game packs and plugins register theirs at boot). Built-in texts win. */
export function registerTranslations(locales: PackLocales | undefined): void {
  if (!locales) return;
  for (const lang of TRANSLATED_LANGS) {
    for (const [en, text] of Object.entries(locales[lang] ?? {})) if (typeof text === 'string') EXTRA[lang].set(en, text);
  }
}

/** Pick the current language of a text, English when it has none. */
export function loc(text: Localized): string {
  return (current === 'en' ? undefined : text[current]) ?? text.en;
}
