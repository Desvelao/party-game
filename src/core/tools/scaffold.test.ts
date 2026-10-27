import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageError } from './args';
import { buildPack } from './gamepack/build';
import { smokeTest } from './gamepack/smoke';
import { verifyPack } from '../server/plugins/pack';
import { addVariant, main } from './scaffold';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pgscaffold-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('scaffold', () => {
  it('creates a game with server, config, test stub, shared types and AGENTS.md that passes the smoke test', async () => {
    expect(await main(['game', 'orb-grab', '--out', root])).toBe(0);
    for (const f of ['game.json', 'AGENTS.md', 'server/index.ts', 'server/config.ts', 'server/index.test.ts', 'shared/types.ts', 'client/index.ts']) expect(existsSync(join(root, 'orb-grab', f))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(root, 'orb-grab', 'game.json'), 'utf8'));
    expect(Object.keys(manifest.locales).sort()).toEqual(['de', 'es', 'fr', 'it', 'pt']);
    const r = await smokeTest(verifyPack((await buildPack(join(root, 'orb-grab'))).files));
    expect(r.errors).toEqual([]);
  });

  it('adds a variant with a guide in every language and refuses duplicates and bad input', async () => {
    await main(['game', 'orb-grab', '--out', root]);
    addVariant('orb-grab', 'orb-rush', 'Orb Rush', 'dash', root);
    const manifest = JSON.parse(readFileSync(join(root, 'orb-grab', 'game.json'), 'utf8'));
    expect(manifest.catalog.variants).toHaveLength(1);
    expect(manifest.catalog.variants[0]).toMatchObject({ id: 'orb-rush', name: 'Orb Rush', action: 'dash' });
    expect(Object.keys(manifest.catalog.variants[0].guide.objective).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt']);
    expect(() => addVariant('orb-grab', 'orb-rush', 'x', 'dash', root)).toThrow(/already has/);
    expect(() => addVariant('orb-grab', 'Bad Id', 'x', 'dash', root)).toThrow(UsageError);
    expect(() => addVariant('orb-grab', 'ok-id', 'x', 'nope', root)).toThrow(UsageError);
    expect(() => addVariant('missing', 'ok-id', 'x', 'dash', root)).toThrow(/does not exist/);
  });
});
