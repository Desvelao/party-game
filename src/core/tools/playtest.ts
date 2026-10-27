/**
 * Headless playtest with scripted inputs: plays one seeded round of a game with the inputs a JSON script lists,
 * far faster than real time, and prints the result (optionally a state trace). Exit code 1 if an `expect` fails.
 *
 *   npm run playtest -- <playableId> --script script.json [--players 2] [--seed 1] [--max-seconds 120] [--trace]
 *
 * Script: { "options": {...}, "inputs": [{ "t": 0, "player": 0, "mx": 1, "my": 0, "a1": false, "a2": false }],
 *           "actions": [{ "t": 3, "player": 1, "data": {...} }], "expect": { "finished": true, "places": [1, 2] } }
 * An input holds until the same player's next one; omitted fields are 0/false. `player` is the slot (0 = "p0").
 * See docs/development/game-packs.md.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { NO_INPUT, type InputState, type OptionValue } from '../shared';
import { registerSourceGames } from '../server/plugins/sourceGames';
import { UsageError, flagValue, parseArgs } from './args';
import { fullOptions } from './balance/sweep';
import { makeGame } from './balance/factories';

export const USAGE = `usage: npm run playtest -- <playableId> --script FILE [--players N] [--seed N] [--max-seconds N] [--trace]`;

const DT = 1 / 60;

export interface Script {
  options?: Record<string, OptionValue>;
  inputs?: { t: number; player: number; mx?: number; my?: number; a1?: boolean; a2?: boolean }[];
  actions?: { t: number; player: number; data: Record<string, unknown> }[];
  expect?: { finished?: boolean; places?: number[] };
}

export function parseScript(text: string): Script {
  let s: Script;
  try {
    s = JSON.parse(text) as Script;
  } catch (e) {
    throw new UsageError(`the script is not valid JSON: ${(e as Error).message}`);
  }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new UsageError('the script must be a JSON object');
  for (const list of [s.inputs ?? [], s.actions ?? []]) {
    if (!Array.isArray(list)) throw new UsageError('"inputs" and "actions" must be arrays');
    for (const e of list) if (typeof e.t !== 'number' || !Number.isInteger(e.player) || e.player < 0) throw new UsageError('every entry needs a numeric "t" and an integer "player" >= 0');
  }
  return s;
}

/** The input a player holds at time `t`: the latest script entry with `entry.t <= t`, else no input. */
export function scriptedInput(script: Script, player: number, t: number): InputState {
  let best: NonNullable<Script['inputs']>[number] | undefined;
  for (const e of script.inputs ?? []) if (e.player === player && e.t <= t && (!best || e.t >= best.t)) best = e;
  return best ? { mx: best.mx ?? 0, my: best.my ?? 0, a1: best.a1 ?? false, a2: best.a2 ?? false } : NO_INPUT;
}

export interface PlaytestResult {
  finished: boolean;
  seconds: number;
  placements: { id: string; place: number }[];
  trace: unknown[];
  failures: string[];
}

export function playtest(playableId: string, script: Script, o: { players?: number; seed?: number; maxSeconds?: number; trace?: boolean } = {}): PlaytestResult {
  const players = o.players ?? 2;
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  const game = makeGame(playableId, fullOptions(playableId, script.options ?? {}), o.seed ?? 1);
  game.init(ids.map((id, i) => ({ id, name: `P${i}` })));
  const pending = [...(script.actions ?? [])].sort((a, b) => a.t - b.t);
  const maxTicks = Math.ceil((o.maxSeconds ?? 120) / DT);
  const trace: unknown[] = [];
  let ticks = 0;
  while (!game.isFinished() && ticks < maxTicks) {
    const t = ticks * DT;
    for (let i = 0; i < ids.length; i++) game.handleInput(ids[i], scriptedInput(script, i, t));
    while (pending.length > 0 && pending[0].t <= t) {
      const a = pending.shift()!;
      if (ids[a.player]) game.handleAction?.(ids[a.player], a.data);
    }
    game.update(DT);
    ticks++;
    if (o.trace && ticks % 60 === 0) trace.push(game.getState());
  }
  const finished = game.isFinished();
  const placements = finished ? game.getPlacements().map((p) => ({ id: p.id, place: p.place })) : [];
  const failures: string[] = [];
  if (script.expect?.finished !== undefined && script.expect.finished !== finished) failures.push(`expected finished=${script.expect.finished}, got ${finished}`);
  const want = script.expect?.places;
  if (want) {
    const got = ids.map((id) => placements.find((p) => p.id === id)?.place);
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`expected places ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  return { finished, seconds: Math.round(ticks * DT * 100) / 100, placements, trace, failures };
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ['script', 'players', 'seed', 'max-seconds']);
  const [id] = args.words;
  if (args.flags.has('help') || !id) {
    console.log(USAGE);
    return id ? 0 : 2;
  }
  const file = flagValue(args, 'script');
  if (!file) throw new UsageError('--script needs a file');
  const num = (name: string): number | undefined => {
    const v = flagValue(args, name);
    if (v === undefined) return undefined;
    if (!Number.isFinite(Number(v))) throw new UsageError(`--${name} must be a number`);
    return Number(v);
  };
  await registerSourceGames();
  const r = playtest(id, parseScript(readFileSync(file, 'utf8')), { players: num('players'), seed: num('seed'), maxSeconds: num('max-seconds'), trace: args.flags.has('trace') });
  if (args.flags.has('trace')) for (const s of r.trace) console.log(JSON.stringify(s));
  console.log(`${id}: ${r.finished ? 'finished' : 'not finished'} after ${r.seconds}s; placements ${r.placements.map((p) => `${p.id}=${p.place}`).join(' ') || '-'}`);
  for (const f of r.failures) console.error(`FAIL: ${f}`);
  return r.failures.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UsageError) {
        console.error(`${err.message}\n\n${USAGE}`);
        process.exit(2);
      }
      console.error(err);
      process.exit(1);
    },
  );
}
