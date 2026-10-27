import { describe, expect, it } from 'vitest';
import { PACK_API_VERSION, validateManifest } from './index';
import { sourceManifests } from '../server/plugins/sourceGames';

const hash = 'a'.repeat(64);
const base = () => ({ ...structuredClone(sourceManifests().find((m) => m.id === 'sprint-smash')!), apiVersion: PACK_API_VERSION, files: { 'server.mjs': hash, 'client.mjs': hash } });
const errorsOf = (m: unknown) => (validateManifest(m) as { ok: false; errors: string[] }).errors ?? [];

describe('manifest tags', () => {
  it('accepts tags from the vocabulary on a game and a variant', () => {
    const m = base();
    m.catalog.variants[0]!.tags = ['points'];
    expect(validateManifest(m).ok).toBe(true);
  });

  it('rejects unknown, repeated and non-list tags', () => {
    for (const bad of [['nope'], ['race', 'race'], 'race', [1]]) {
      const m = base();
      (m.catalog as { tags?: unknown }).tags = bad;
      expect(errorsOf(m).join(), JSON.stringify(bad)).toMatch(/catalog\.tags must be a list/);
    }
    const m = base();
    (m.catalog.variants[1] as { tags?: unknown }).tags = ['nope'];
    expect(errorsOf(m).join()).toMatch(/variants\[1\]\.tags/);
  });
});

describe('manifest locales', () => {
  it('accepts texts in any supported language, each optional', () => {
    const m = base();
    m.locales = { fr: { Hi: 'Salut' }, it: { Hi: 'Ciao' } };
    expect(validateManifest(m).ok).toBe(true);
    m.locales = {};
    expect(validateManifest(m).ok).toBe(true);
  });

  it('rejects an unknown language and non-text values', () => {
    const m = base();
    (m as { locales: unknown }).locales = { xx: { Hi: 'Hi' } };
    expect(errorsOf(m).join('\n')).toContain('locales must be');
    (m as { locales: unknown }).locales = { fr: { Hi: 3 } };
    expect(errorsOf(m).join('\n')).toContain('locales must be');
  });

  it('needs the English text of a guide and checks its translations', () => {
    const m = base();
    m.catalog.guide.objective = { en: 'Win.', de: 'Gewinne.' };
    expect(validateManifest(m).ok).toBe(true);
    (m.catalog.guide as { objective: unknown }).objective = { de: 'Gewinne.' };
    expect(errorsOf(m).join('\n')).toContain('objective must be an { en } text');
    (m.catalog.guide as { objective: unknown }).objective = { en: 'Win.', pt: 3 };
    expect(errorsOf(m).join('\n')).toContain('objective must be an { en } text');
  });
});

describe('manifest characters', () => {
  const model = { id: 'robot', name: 'Robot', slots: [{ id: 'head', label: 'Head', options: [{ label: 'Round' }, { label: 'Square' }], default: 0 }] };
  it('accepts the models a game provides and the one it is drawn with', () => {
    expect(base().character).toBe('blob');
    expect(validateManifest({ ...base(), characters: [model], character: 'robot' }).ok).toBe(true);
    const { character: _, ...none } = base();
    expect(validateManifest(none).ok).toBe(true);
  });
  it('rejects a bad model list or model id', () => {
    expect(errorsOf({ ...base(), characters: [{ ...model, slots: [] }] }).join()).toMatch(/characters\[0\]\.slots/);
    expect(errorsOf({ ...base(), character: 'Robot!' }).join()).toMatch(/character must be the id/);
  });
});
