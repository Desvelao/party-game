import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackError, verifyPack } from '../server/plugins/pack';
import { UsageError } from './args';
import { initGame } from './gamepack';
import { buildPack } from './gamepack/build';
import { smokeTest } from './gamepack/smoke';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pgtool-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const verified = async (dir: string) => verifyPack((await buildPack(dir)).files);

describe('gamepack', () => {
  it('scaffolds a game that builds and passes the smoke test', async () => {
    const dir = initGame('orb-grab', 'Orb Grab', root);
    const pack = await verified(dir);
    expect(pack.manifest).toMatchObject({ id: 'orb-grab', version: '0.1.0' });
    const r = await smokeTest(pack);
    expect(r.errors).toEqual([]);
    expect(r.runs.length).toBeGreaterThan(0);
  });

  it('builds the same bytes twice', async () => {
    const dir = initGame('orb-grab', 'Orb Grab', root);
    const a = await buildPack(dir);
    const b = await buildPack(dir);
    expect(a.files.get('game.json')?.equals(b.files.get('game.json')!)).toBe(true);
    expect(a.files.get('server.mjs')?.equals(b.files.get('server.mjs')!)).toBe(true);
  });

  it('rejects bad ids and existing directories', () => {
    expect(() => initGame('Bad Id', 'x', root)).toThrow(UsageError);
    initGame('orb-grab', 'Orb Grab', root);
    expect(() => initGame('orb-grab', 'Orb Grab', root)).toThrow(/already exists/);
  });

  it('refuses code that bundles core internals at runtime', async () => {
    const dir = initGame('orb-grab', 'Orb Grab', root);
    const file = join(dir, 'server/index.ts');
    const src = readFileSync(file, 'utf8');
    writeFileSync(file, `import { CATALOG } from '${join(process.cwd(), 'src/core/shared/catalog')}';\nconsole.log(CATALOG.length);\n${src}`);
    await expect(buildPack(dir)).rejects.toThrow(/imports core modules at runtime/);
  });

  it('reports a manifest problem and a syntax error', async () => {
    const dir = initGame('orb-grab', 'Orb Grab', root);
    const manifest = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
    manifest.version = 'one';
    writeFileSync(join(dir, 'game.json'), JSON.stringify(manifest));
    await expect(buildPack(dir)).rejects.toThrow(/version must look like/);
    manifest.version = '1.0.0';
    writeFileSync(join(dir, 'game.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'client/index.ts'), 'export default {');
    await expect(buildPack(dir)).rejects.toBeInstanceOf(PackError);
  });

  it('smoke test catches a missing placement, a wrong kind and a round that never ends', async () => {
    const dir = initGame('orb-grab', 'Orb Grab', root);
    const file = join(dir, 'server/index.ts');
    const src = readFileSync(file, 'utf8');

    writeFileSync(file, src.replace("return ranked.map((p) =>", "return ranked.slice(1).map((p) =>"));
    expect((await smokeTest(await verified(dir))).errors.join('\n')).toMatch(/missing from the placements/);

    writeFileSync(file, src.replace("kind: 'ext:orb-grab'", "kind: 'orb-grab'"));
    expect((await smokeTest(await verified(dir))).errors.join('\n')).toMatch(/must start with "ext:"/);

    writeFileSync(file, src.replace("return t >= limit || players.every((p) => p.gone);", 'return false;'));
    expect((await smokeTest(await verified(dir))).errors.join('\n')).toMatch(/did not end/);
  }, 30_000);
});
