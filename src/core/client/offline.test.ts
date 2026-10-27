import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LANGS, LANG_KEY } from '../shared/i18n';

const html = readFileSync(new URL('./public/offline.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;

/** Run the page's script against a fake document; returns what it wrote. */
function render(navigatorLang: string, saved: string | null) {
  const els: Record<string, { textContent: string; addEventListener: () => void }> = {};
  for (const id of ['t', 'p', 'b']) els[id] = { textContent: `default-${id}`, addEventListener: () => {} };
  const doc = { documentElement: { lang: 'en' }, title: '', getElementById: (id: string) => els[id] };
  runInNewContext(script, {
    document: doc,
    navigator: { language: navigatorLang },
    localStorage: { getItem: (k: string) => (k === LANG_KEY ? saved : null) },
    location: { reload: () => {} },
  });
  return { lang: doc.documentElement.lang, title: doc.title, heading: els.t.textContent, text: els.p.textContent, button: els.b.textContent };
}

describe('public/offline.html', () => {
  it('has a translation for every language of the game, all different from English', () => {
    const en = render('en', 'en');
    expect(en.heading).toBe('default-t'); // English is the markup itself
    const seen = new Set<string>();
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      const r = render('en', lang);
      expect(r.lang).toBe(lang);
      expect(r.heading).toBe(r.title);
      for (const text of [r.heading, r.text, r.button]) {
        expect(text).not.toMatch(/^default-/);
        seen.add(text);
      }
    }
    expect(seen.size).toBe((LANGS.length - 1) * 3);
  });

  it('follows the saved language, then the browser, then English', () => {
    expect(render('fr-FR', null).lang).toBe('fr');
    expect(render('fr-FR', 'de').lang).toBe('de');
    expect(render('fr-FR', 'en').lang).toBe('en'); // a saved English wins over the browser
    expect(render('ja-JP', null).lang).toBe('en');
    expect(render('es', 'xx').lang).toBe('es'); // an unknown saved value is ignored, like in the app
  });

  it('reads the storage key the app writes', () => {
    expect(html).toContain(`'${LANG_KEY}'`);
  });
});
