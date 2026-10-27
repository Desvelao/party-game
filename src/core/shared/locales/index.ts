/** Every translated UI catalog. Each must define exactly the keys of `en.ts` with the same `{placeholders}` (a test asserts it). */
import type { TranslatedLang } from '../i18n';
import type { MessageKey } from './en';
import { ES } from './es';
import { FR } from './fr';
import { DE } from './de';
import { PT } from './pt';
import { IT } from './it';

export { CATALOGS } from './catalog';

export const LOCALES: Record<TranslatedLang, Record<MessageKey, string>> = { es: ES, fr: FR, de: DE, pt: PT, it: IT };
