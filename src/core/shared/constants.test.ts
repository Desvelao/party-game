import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from './constants';

describe('CORE_VERSION', () => {
  it('equals the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(CORE_VERSION).toBe(pkg.version);
  });
});
