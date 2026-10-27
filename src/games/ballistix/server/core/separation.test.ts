import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BallArena } from './BallArena';
import { CORE_DEFAULTS } from './config';

const coreDir = __dirname;
const sources = readdirSync(coreDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ file: f, code: readFileSync(path.join(coreDir, f), 'utf8') }));

/** drop // and /* *\/ comments so prose can mention variants */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('core / variants separation', () => {
  it('core code does not import from variants', () => {
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/from\s+['"][^'"]*variants/);
    }
  });

  it('core code names no specific variant or variant feature', () => {
    for (const { file, code } of sources) {
      const words = stripComments(code).match(/\b(magnet|enemy|engine|bumper|sand|cloud|pulseball|smashball|fuse|wind)s?\b/gi);
      expect(words, file).toBeNull();
    }
  });

  it('the core plays a full round with no modules and exposes no variant state', () => {
    const g = new BallArena({ ...CORE_DEFAULTS, id: 'core', name: 'Core' }, undefined, 5);
    g.init([
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b' },
    ]);
    for (let i = 0; i < 60 * 40 && !g.isFinished(); i++) {
      g.handleInput('a', { mx: Math.sin(i / 25), my: 0, a1: i % 90 === 0, a2: false });
      g.update(1 / 60);
    }
    const st = g.getState();
    expect(st.balls.length).toBeGreaterThan(1); // reinforcements are core
    expect(st.magnet).toBeUndefined();
    expect(st.enemy).toBeUndefined();
    expect(st.engines).toBeUndefined();
    expect(st.sides.some((s) => s.used)).toBe(true);
  });
});
