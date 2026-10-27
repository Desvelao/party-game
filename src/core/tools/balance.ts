/**
 * Balance playtesting: plays seeded rounds of every minigame with scripted bots, far faster than
 * real time, and reports duration, spawn-slot bias, skill gap and stuck rounds.
 *
 *   npm run balance -- --variant smashball --players 2,4 --seeds 20 --out balance.jsonl
 *   npm run balance -- --report balance.jsonl
 *
 * See docs/development/balance-testing.md.
 */
import { createWriteStream, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ALL_PLAYABLES } from '../shared';
import { registerSourceGames } from '../server/plugins/sourceGames';
import { report } from './balance/report';
import { runOne, type Row } from './balance/runner';
import { SCENARIOS, buildSweep, type Scenario } from './balance/sweep';

const USAGE = `usage: npm run balance -- [options]

--variant ID[,ID...]   variants to play (default: all; --list shows the ids)
--players N[,N...]     player counts (default 2,4; variants with a lower limit skip the larger ones)
--seeds N              seeds per combination (default 10)
--scenarios S[,S...]   random, greedy, skill, idle (default: all four)
--sweep none|options   options: also run every option at its min/max, one at a time (default none)
--out FILE             write one JSON line per player per round (default balance.jsonl)
--no-report            do not print the report after the run
--report FILE          only print the report of an earlier --out file
--csv FILE             with --report: also write the rows as CSV
--list                 list the variant ids and exit`;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const fail = (msg: string): never => {
  console.error(`${msg}\n\n${USAGE}`);
  process.exit(2);
};

function csv(rows: Row[]): string {
  const head = ['variant', 'options', 'playerCount', 'seed', 'scenario', 'policy', 'slot', 'place', 'firstPlaces', 'durationSec', 'limitSec', 'timedOut', 'metric'];
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head.join(','), ...rows.map((r) => head.map((h) => cell(h === 'options' ? JSON.stringify(r.options) : (r as unknown as Record<string, unknown>)[h])).join(','))].join('\n');
}

function readRows(file: string): Row[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
}

async function main(): Promise<void> {
  if (flag('help') || flag('h')) return console.log(USAGE);
  // the core has no game of its own: play the ones under src/games
  await registerSourceGames();
  if (flag('list')) return console.log(ALL_PLAYABLES.map((p) => p.id).join('\n'));

  if (flag('report')) {
    const file = arg('report', '');
    if (!file) return fail('--report needs a file');
    const rows = readRows(file);
    console.log(report(rows).text);
    if (flag('csv')) {
      const out = arg('csv', '');
      if (!out) return fail('--csv needs a file');
      createWriteStream(out).end(csv(rows) + '\n');
    }
    return;
  }

  const known = new Set(ALL_PLAYABLES.map((p) => p.id));
  const variants = flag('variant') ? list(arg('variant', '')) : [...known];
  for (const v of variants) if (!known.has(v)) fail(`unknown variant "${v}"`);
  const players = list(arg('players', '2,4')).map(Number);
  if (players.some((n) => !Number.isInteger(n) || n < 2 || n > 64)) fail('--players must be whole numbers from 2 to 64');
  const seeds = Number(arg('seeds', '10'));
  if (!Number.isInteger(seeds) || seeds < 1) fail('--seeds must be a positive whole number');
  const scenarios = list(arg('scenarios', SCENARIOS.join(','))) as Scenario[];
  for (const s of scenarios) if (!SCENARIOS.includes(s)) fail(`unknown scenario "${s}"`);
  const sweep = arg('sweep', 'none');
  if (sweep !== 'none' && sweep !== 'options') fail('--sweep must be none or options');

  const specs = buildSweep({ variants, players, seeds, scenarios, options: sweep === 'options' });
  if (!specs.length) return fail('nothing to run: no variant fits those player counts');
  const outFile = arg('out', 'balance.jsonl');
  const out = createWriteStream(outFile);
  const rows: Row[] = [];
  const t0 = performance.now();
  for (let i = 0; i < specs.length; i++) {
    for (const row of runOne(specs[i])) {
      rows.push(row);
      out.write(JSON.stringify(row) + '\n');
    }
    if (process.stderr.isTTY && (i % 20 === 0 || i === specs.length - 1)) process.stderr.write(`\r${i + 1}/${specs.length} rounds`);
  }
  await new Promise<void>((done) => out.end(done));
  console.error(`\n${specs.length} rounds, ${rows.length} rows -> ${outFile} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (!flag('no-report')) console.log('\n' + report(rows).text);
}

void main();
