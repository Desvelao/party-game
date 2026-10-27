/**
 * Aggregates bot/reports/* into one markdown summary meant to be read by Claude Code (or a person).
 *
 *   npm run bot:analyze                       # all reports, writes bot/reports/summary.md
 *   npm run bot:analyze -- --reports DIR --out FILE
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSummary, type Run } from './summary';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const dir = arg('reports', new URL('./reports', import.meta.url).pathname);
const out = arg('out', join(dir, 'summary.md'));

const runs: Run[] = [];
// reports are <dir>/<report>/match.json, or <dir>/<arena run>/<report>/match.json for bot:arena runs
function scan(base: string, rel: string, depth: number): void {
  if (!existsSync(base)) return;
  for (const d of readdirSync(base).sort()) {
    const sub = join(base, d);
    const f = join(sub, 'match.json');
    if (existsSync(f)) runs.push({ name: join(rel, d), m: JSON.parse(readFileSync(f, 'utf8')), group: rel });
    else if (depth > 0 && statSync(sub).isDirectory()) scan(sub, join(rel, d), depth - 1);
  }
}
scan(dir, '', 1);
if (!runs.length) {
  console.error(`no reports in ${dir}`);
  process.exit(1);
}

const md = buildSummary(runs, dir);
writeFileSync(out, md);
console.log(md);
console.log(`\nwritten to ${out}`);
