import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTINGS } from './config';

const docs = {
  'config.example.yaml': readFileSync('config.example.yaml', 'utf8'),
  'README.md': readFileSync('README.md', 'utf8'),
  'docs/manual/configuration.md': readFileSync('docs/manual/configuration.md', 'utf8'),
};

/** Every setting of the file schema is documented in the example file, the README table and the manual's table. */
describe('settings documentation', () => {
  it.each(SETTINGS.map((s) => [s.path.join('.'), s] as const))('%s', (_name, s) => {
    const key = s.path[s.path.length - 1]!;
    expect(docs['config.example.yaml'], `config.example.yaml: ${key}`).toMatch(new RegExp(`^\\s*#?\\s*${key}:`, 'm'));
    expect(docs['config.example.yaml'], `config.example.yaml: ${s.env}`).toContain(s.env);
    for (const file of ['README.md', 'docs/manual/configuration.md'] as const) {
      expect(docs[file], `${file}: ${s.path.join('.')}`).toContain(`\`${s.path.join('.')}\``);
      expect(docs[file], `${file}: ${s.env}`).toContain(`\`${s.env}\``);
    }
  });
});
