import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRANSLATED_LANGS, defaultLook, validatePluginManifest, type CharacterModelDef, type PluginManifest } from '../../../core/shared';
import { HAIR_COLORS, blobShapes } from './blob';
import plugin from './index';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'plugin.json'), 'utf8')) as PluginManifest;
const blob = manifest.characters!.find((m) => m.id === 'blob') as CharacterModelDef;

describe('characters plugin', () => {
  it('has a valid manifest and draws every model it declares', () => {
    expect(validatePluginManifest({ ...manifest, apiVersion: 2, files: { 'server.mjs': 'a'.repeat(64), 'client.mjs': 'b'.repeat(64) } })).toMatchObject({ ok: true });
    expect(Object.keys(plugin.characters!).sort()).toEqual(manifest.characters!.map((m) => m.id).sort());
  });

  it('translates the model, its slots and every option in its slot, in every language', () => {
    for (const lang of TRANSLATED_LANGS) {
      const table = manifest.locales?.[lang] ?? {};
      const texts = [blob.name, ...blob.slots.flatMap((s) => [s.label, ...s.options.map((o) => `${s.label}: ${o.label}`)])];
      for (const text of texts) expect(table[text], `${lang}: ${text}`).toBeTruthy();
    }
  });

  it('shows the hair colours it draws', () => {
    expect(blob.slots.find((s) => s.id === 'hairColor')!.options.map((o) => o.swatch)).toEqual(HAIR_COLORS);
  });

  it('is deterministic and starts with the body in the player colour', () => {
    const look = defaultLook(blob);
    const a = blobShapes(look, 0xff0000, 10, 0.5);
    expect(blobShapes(look, 0xff0000, 10, 0.5)).toEqual(a);
    expect(a[0].fill).toBe(0xff0000);
    expect(blobShapes({ ...look, hat: 2, glasses: 1 }, 1, 10, 0).length).toBeGreaterThan(blobShapes({ ...look, hat: 0, glasses: 0 }, 1, 10, 0).length);
  });

  it('every option of every slot renders finite coordinates', () => {
    for (const slot of blob.slots) {
      for (let i = 0; i < slot.options.length; i++) {
        for (const s of blobShapes({ ...defaultLook(blob), [slot.id]: i }, 0xffffff, 20, 1.2)) {
          const nums = s.k === 'circle' ? [s.x, s.y, s.r] : s.pts;
          for (const n of nums) expect(Number.isFinite(n)).toBe(true);
        }
      }
    }
  });
});
