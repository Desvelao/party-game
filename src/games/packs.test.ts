/**
 * Checks every game under src/games/ the way the pack tools and the loader would: manifest valid,
 * server and client entries export what the contract needs, every playable starts, the client
 * ships music.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_API_VERSION, defaultOptions, optionsFor, playablesOf, validateManifest, type ServerGamePlugin } from '../core/shared';
import type { ClientGamePlugin } from '../core/client/src/plugins/api';
import { sourceManifests } from '../core/server/plugins/sourceGames';

const hash = 'a'.repeat(64);

describe.each(sourceManifests().map((m) => [m.id, m] as const))('game pack %s', (id, manifest) => {
  it('has a valid manifest in a folder named after its id', () => {
    expect(existsSync(join(__dirname, id, 'game.json'))).toBe(true);
    expect(readdirSync(__dirname)).toContain(id);
    const r = validateManifest({ ...manifest, apiVersion: PACK_API_VERSION, files: { 'server.mjs': hash, 'client.mjs': hash } });
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('server plugin starts every playable with its default options', async () => {
    const plugin = ((await import(`./${id}/server/index.ts`)) as { default: ServerGamePlugin }).default;
    for (const p of playablesOf(manifest.catalog)) {
      const g = plugin.createMinigame(p.id, defaultOptions(optionsFor(manifest.id, p.id === manifest.id ? 'all' : p.id)));
      g.init([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      for (let i = 0; i < 30; i++) g.update(1 / 60);
      const state = g.getState();
      expect(state.kind, p.id).toMatch(/^ext:/);
      expect(() => JSON.stringify(state)).not.toThrow();
    }
  });

  it('client plugin draws its state kind and ships music', async () => {
    const plugin = ((await import(`./${id}/client/index.ts`)) as { default: ClientGamePlugin }).default;
    expect(plugin.kinds.length).toBeGreaterThan(0);
    for (const k of plugin.kinds) expect(k).toMatch(/^ext:/);
    expect(typeof plugin.createRenderer).toBe('function');
    const t = plugin.music;
    expect(t, 'music').toBeDefined();
    expect(t!.melody).toHaveLength(t!.bass.length);
    for (const s of [...t!.kick, ...t!.snare, ...t!.hat]) expect(s).toBeLessThan(t!.bass.length);
    const seconds = (t!.bass.length * 60) / t!.bpm / 2;
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(12);
  });
});
