import { describe, expect, it } from 'vitest';
import { CATALOG, ALL_VARIANTS_DESCRIPTION, MIXED_DESCRIPTION, ROUNDS_TO_WIN_OPTION, type OptionDef } from './catalog';
import { LANGS, TRANSLATED_LANGS, getLang, isPackLocales, loc, registerTranslations, setLang, t, tr, type Localized } from './i18n';
import { EN } from './locales/en';
import { CATALOGS, LOCALES } from './locales';

import { sourceManifests } from '../server/plugins/sourceGames';

const allOptions = (): OptionDef[] =>
  // ROUNDS_TO_WIN_OPTION is appended to every game by optionsFor, so it is not in the data
  [ROUNDS_TO_WIN_OPTION, ...CATALOG.flatMap((g) => [...(g.options ?? []), ...g.variants.flatMap((v) => v.options ?? [])])];

describe('i18n', () => {
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

  describe.each(TRANSLATED_LANGS)('%s', (lang) => {
    it('has the same UI keys, placeholders and no empty text as en', () => {
      expect(Object.keys(LOCALES[lang]).sort()).toEqual(Object.keys(EN).sort());
      for (const k of Object.keys(EN) as (keyof typeof EN)[]) {
        expect(LOCALES[lang][k].trim(), `${lang} ${k}`).not.toBe('');
        expect(ph(LOCALES[lang][k]), `${lang} ${k}`).toBe(ph(EN[k]));
      }
    });
  });

  it('lists every language once, English first', () => {
    expect(LANGS[0]).toBe('en');
    expect(new Set(LANGS).size).toBe(LANGS.length);
    expect(Object.keys(LOCALES).sort()).toEqual([...TRANSLATED_LANGS].sort());
    expect(Object.keys(CATALOGS).sort()).toEqual([...TRANSLATED_LANGS].sort());
  });

  it('interpolates and switches language', () => {
    const before = getLang();
    setLang('en');
    expect(t('lobby.players', { n: 2, max: 8 })).toBe('Players 2/8');
    setLang('es');
    expect(t('lobby.players', { n: 2, max: 8 })).toBe('Jugadores 2/8');
    expect(tr('Time limit')).toBe('Tiempo límite');
    setLang('fr');
    expect(t('lobby.players', { n: 2, max: 8 })).toBe('Joueurs 2/8');
    expect(tr('Rounds to win')).toBe('Manches à gagner');
    setLang('en');
    expect(tr('Time limit')).toBe('Time limit');
    setLang(before);
  });

  const catalogTexts = (): Set<string> => {
    const texts = new Set<string>([MIXED_DESCRIPTION, ALL_VARIANTS_DESCRIPTION]);
    for (const g of CATALOG) {
      texts.add(g.description);
      g.variants.forEach((v) => texts.add(v.description));
    }
    for (const o of allOptions()) {
      texts.add(o.label);
      texts.add(o.description);
      if (o.zeroLabel) texts.add(o.zeroLabel);
      o.choices?.forEach((c) => texts.add(c.label));
    }
    return texts;
  };

  it.each(TRANSLATED_LANGS)('translates every catalog text in %s', (lang) => {
    // a game ships its own texts (`locales` in game.json); the core catalog has the rest
    const packTexts = new Set(sourceManifests().flatMap((m) => Object.keys(m.locales?.[lang] ?? {})));
    const missing = [...catalogTexts()].filter((s) => !(s in CATALOGS[lang]) && !packTexts.has(s) && !/^\d+$/.test(s));
    expect(missing).toEqual([]);
  });

  it.each(TRANSLATED_LANGS)('has no stale %s catalog entries', (lang) => {
    const texts = catalogTexts();
    // game and variant names are shown verbatim, so an entry for one is a leftover too
    expect(Object.keys(CATALOGS[lang]).filter((k) => !texts.has(k))).toEqual([]);
  });

  it('keeps the placeholders of every pack text', () => {
    for (const m of sourceManifests()) {
      for (const lang of TRANSLATED_LANGS) {
        for (const [en, text] of Object.entries(m.locales?.[lang] ?? {})) expect(ph(text), `${m.id} ${lang}: ${en}`).toBe(ph(en));
      }
    }
  });

  it('falls back to English for a missing translation', () => {
    const before = getLang();
    registerTranslations({ fr: { 'Only French here': 'Seulement en français' } });
    setLang('de');
    expect(tr('Only French here')).toBe('Only French here');
    setLang('fr');
    expect(tr('Only French here')).toBe('Seulement en français');
    const text: Localized = { en: 'Hello', fr: 'Bonjour' };
    expect(loc(text)).toBe('Bonjour');
    setLang('it');
    expect(loc(text)).toBe('Hello');
    setLang(before);
  });

  it('validates the shape of pack locales', () => {
    expect(isPackLocales({ fr: { a: 'b' }, it: {} }, 10, 50)).toBe(true);
    expect(isPackLocales({ xx: { a: 'b' } }, 10, 50)).toBe(false);
    expect(isPackLocales({ fr: { a: 1 } }, 10, 50)).toBe(false);
    expect(isPackLocales({ fr: { a: 'b', c: 'd' } }, 1, 50)).toBe(false);
    expect(isPackLocales({ fr: { a: 'too long' } }, 10, 3)).toBe(false);
    expect(isPackLocales(['fr'], 10, 50)).toBe(false);
  });

  it('gives every game and variant a guide in every language', () => {
    const guides = CATALOG.flatMap((g) => [g.guide, ...g.variants.map((v) => v.guide)]);
    expect(guides).toHaveLength(CATALOG.length + CATALOG.reduce((n, g) => n + g.variants.length, 0));
    for (const gd of guides) {
      const complete = (x: Localized) => LANGS.every((l) => Boolean(x[l]?.trim()));
      expect(complete(gd.objective), gd.objective.en).toBe(true);
      expect(gd.rules.length).toBeGreaterThan(0);
      for (const r of [...gd.rules, ...(gd.items ?? []).flatMap((i) => [i.name, i.description])]) {
        expect(complete(r), r.en).toBe(true);
      }
    }
  });
});
