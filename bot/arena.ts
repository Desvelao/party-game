/**
 * Scenario runner: starts a whole room of bots (and waits for humans) from one command.
 *
 *   npm run bot:arena -- bot/scenarios/ladder.json
 *   npm run bot:arena -- bot/scenarios/bot-vs-human-normal.json --matches 3
 *   npm run bot:arena -- --seats hard,normal,human --variant smashball --opt lives=3 --matches 2
 *   npm run bot:arena -- bot/scenarios/stress.json --rooms 3          # three rooms in parallel
 *   npm run bot:arena -- bot/scenarios/ladder.json --offline --rooms 20 # no server: simulated, faster than real time (rooms in sequence)
 *
 * The first bot seat creates the room and hosts it; the other bots join with its code; for each `human` seat the
 * code is printed and the match starts once everybody is ready. With --offline the rooms play the headless game
 * simulation in-process instead (bot/offline.ts; bots only). Reports go to bot/reports/<scenario>-<stamp>/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PROFILES, effectiveNetworkRate, type ProfileName } from '../src/core/server/config';
import { seededIds } from '../src/core/server/minigames';
import { registerSourceGames } from '../src/core/server/plugins/sourceGames';
import { selectionPlayerLimit } from '../src/core/shared/catalog';
import { BotClient, type ClientOptions } from './core/client';
import { DEFAULT_BOT_GAME, coerceCliOptions } from './core/options';
import { registeredGames } from './core/registry';
import './games';
import { runOfflineRoom } from './offline';

export interface Seat {
  /** level of a bot seat, e.g. "hard" */
  bot?: string;
  human?: boolean;
  name?: string;
  policy?: string;
  /** extra parameter overrides on top of the level */
  params?: Record<string, number>;
}

export interface Scenario {
  name: string;
  description?: string;
  url?: string;
  game?: string;
  variant?: string;
  options?: Record<string, number | boolean | string>;
  seats: Seat[];
  /** matches per room before the bots leave; 0 = forever (default 1) */
  matches?: number;
  /** identical rooms (default 1): in parallel on a server, one after another with --offline (the simulation is CPU-bound) */
  rooms?: number;
  startDelayMs?: number;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "hard,normal,human" -> seats */
export function parseSeats(spec: string): Seat[] {
  return spec
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t === 'human' ? { human: true } : { bot: t }));
}

export function validateScenario(sc: Scenario, offline = false): string[] {
  const errs: string[] = [];
  if (offline && sc.seats?.some((s) => s.human)) errs.push('offline rooms are bots only (drop the human seats)');
  if (!sc.seats?.length) errs.push('no seats');
  const game = sc.game ?? DEFAULT_BOT_GAME;
  const limit = selectionPlayerLimit({ game, variant: sc.variant ?? 'all', options: sc.options ?? {} });
  if (limit !== undefined && sc.seats?.length > limit) errs.push(`${game} allows at most ${limit} players`);
  if (sc.seats && !sc.seats.some((s) => s.bot !== undefined)) errs.push('at least one bot seat is needed to host the room');
  const levels = new Set(registeredGames().flatMap((g) => Object.keys(g.levels ?? {})));
  for (const s of sc.seats ?? []) if (s.bot && !levels.has(s.bot)) errs.push(`unknown level '${s.bot}' (${[...levels].join(', ')})`);
  return errs;
}

export function seatNames(sc: Scenario, room: number): string[] {
  const used = new Map<string, number>();
  return sc.seats.map((s) => {
    const base = s.name ?? (s.human ? 'Human' : cap(s.bot ?? 'bot'));
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const dup = sc.seats.filter((x) => (x.name ?? (x.human ? 'Human' : cap(x.bot ?? 'bot'))) === base).length > 1;
    return `${base}${dup ? `-${n}` : ''}${(sc.rooms ?? 1) > 1 ? `.R${room}` : ''}`.slice(0, 16);
  });
}

async function runRoom(sc: Scenario, room: number, dir: string, stops: (() => void)[]): Promise<{ code: string; names: string[] }> {
  const names = seatNames(sc, room);
  const bots = sc.seats.map((s, i) => ({ s, i, name: names[i] })).filter((x) => !x.s.human);
  const humans = sc.seats.filter((s) => s.human).length;
  const tag = `room${room}`;
  const log = (who: string) => (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${tag} ${who}: ${line}`);

  const make = (x: (typeof bots)[number], code: string | undefined, onJoined?: (c: string) => void): BotClient => {
    const o: ClientOptions = {
      url: sc.url ?? 'ws://localhost:8080/ws',
      name: x.name,
      code,
      create: code ? undefined : { game: sc.game ?? DEFAULT_BOT_GAME, variant: sc.variant, options: sc.options },
      minPlayers: sc.seats.length,
      startDelayMs: sc.startDelayMs ?? 3000,
      resultsDelayMs: 3000,
      matches: sc.matches ?? 1,
      reportsDir: dir,
      policy: x.s.policy,
      level: x.s.bot,
      scenario: sc.name,
      seat: x.name,
      params: x.s.params ?? {},
      seed: (Date.now() + x.i * 7919 + room * 104729) % 1e9,
      onJoined,
      log: log(x.name),
    };
    const c = new BotClient(o);
    stops.push(() => c.stop());
    return c;
  };

  let codeResolve!: (c: string) => void;
  const codeP = new Promise<string>((r) => (codeResolve = r));
  const host = make(bots[0], undefined, (c) => codeResolve(c));
  const runs: Promise<void>[] = [host.run()];
  const code = await Promise.race([codeP, runs[0].then(() => '')]);
  if (!code) throw new Error(`room ${room}: the host bot could not create the room`);
  console.log(`\n=== ${tag}: code ${code}${humans ? `  -> join it in the browser as ${humans} human player(s)` : ''}\n`);
  for (const x of bots.slice(1)) {
    runs.push(make(x, code).run());
    await new Promise((r) => setTimeout(r, 300));
  }
  const res = await Promise.allSettled(runs);
  for (const r of res) if (r.status === 'rejected') console.error(`${tag}: ${(r.reason as Error).message}`);
  return { code, names };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
  };
  const file = argv.find((a) => a.endsWith('.json'));
  if (!file && !arg('seats')) {
    console.log(`usage: npm run bot:arena -- <scenario.json | --seats hard,normal,human> [--url URL] [--game ID] [--variant ID] [--opt k=v]
         [--matches N] [--rooms N] [--name NAME] [--reports DIR]
         [--offline [--profile LOW_POWER|NORMAL|HIGH] [--tick HZ] [--net HZ] [--seed N] [--verbose]]

Seats: a level (${[...new Set(registeredGames().flatMap((g) => Object.keys(g.levels ?? {})))].join(', ')}) = a bot, "human" = wait for a person.
Scenario files: bot/scenarios/*.json (see bot/README.md).
--offline: no server; the bots play the game simulation faster than real time (rates of --profile, default NORMAL).`);
    process.exit(1);
  }
  const sc: Scenario = file ? JSON.parse(readFileSync(file, 'utf8')) : { name: arg('name') || 'adhoc', seats: [] };
  if (arg('seats')) sc.seats = parseSeats(arg('seats'));
  if (arg('url')) sc.url = arg('url');
  if (arg('game')) sc.game = arg('game');
  if (arg('variant')) sc.variant = arg('variant');
  if (arg('matches')) sc.matches = Number(arg('matches'));
  if (arg('rooms')) sc.rooms = Number(arg('rooms'));
  if (!seededIds().length) await registerSourceGames();
  const opts = argv.flatMap((a, i): [string, string][] => {
    if (a !== '--opt' || !argv[i + 1]) return [];
    const [k, ...rest] = argv[i + 1].split('=');
    return [[k, rest.join('=')]];
  });
  if (opts.length) sc.options = { ...sc.options, ...coerceCliOptions(opts, sc.game ?? DEFAULT_BOT_GAME, sc.variant) };
  const offline = argv.includes('--offline');
  const errs = validateScenario(sc, offline);
  if (errs.length) {
    console.error(`invalid scenario: ${errs.join('; ')}`);
    process.exit(1);
  }

  const dir = join(arg('reports') || new URL('./reports', import.meta.url).pathname, `${sc.name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  const stops: (() => void)[] = [];
  process.on('SIGINT', () => stops.forEach((s) => s()));
  process.on('SIGTERM', () => stops.forEach((s) => s()));

  const rooms = Math.max(1, sc.rooms ?? 1);
  if (offline) {
    const profile = (arg('profile') || 'NORMAL') as ProfileName;
    if (!PROFILES[profile]) {
      console.error(`unknown profile '${profile}' (${Object.keys(PROFILES).join(', ')})`);
      process.exit(1);
    }
    const tickRate = Number(arg('tick')) || PROFILES[profile].tickRate;
    const networkRate = effectiveNetworkRate(tickRate, Number(arg('net')) || PROFILES[profile].networkRate);
    const seed = Number(arg('seed')) || 1;
    console.log(`scenario ${sc.name} offline (${tickRate}/${networkRate} Hz, seed ${seed}): ${sc.seats.map((s) => s.bot).join(' vs ')}, ${rooms} room(s), ${sc.matches ?? 1} match(es) each; reports in ${dir}`);
    const t0 = performance.now();
    const rs = [];
    for (let i = 1; i <= rooms; i++) {
      rs.push(await runOfflineRoom(sc, i, dir, seatNames(sc, i), { tickRate, networkRate, seed, log: argv.includes('--verbose') ? console.log : undefined }));
      console.log(`room${i} done`);
    }
    writeFileSync(join(dir, 'arena.json'), JSON.stringify({ scenario: sc, offline: { tickRate, networkRate, seed }, rooms: rs, finishedAt: new Date().toISOString() }, null, 1));
    console.log(`\ndone in ${((performance.now() - t0) / 1000).toFixed(1)} s. Analyze with: npm run bot:analyze -- --reports ${dir}`);
    return;
  }
  console.log(`scenario ${sc.name}: ${sc.seats.map((s) => (s.human ? 'human' : s.bot)).join(' vs ')}, ${rooms} room(s), ${sc.matches ?? 1} match(es) each; reports in ${dir}`);
  const results = await Promise.allSettled(Array.from({ length: rooms }, (_, i) => runRoom(sc, i + 1, dir, stops)));
  const rs = results.map((r) => (r.status === 'fulfilled' ? r.value : { code: '', names: [] as string[], error: String((r.reason as Error).message) }));
  writeFileSync(join(dir, 'arena.json'), JSON.stringify({ scenario: sc, rooms: rs, finishedAt: new Date().toISOString() }, null, 1));
  for (const r of results) if (r.status === 'rejected') console.error((r.reason as Error).message);
  console.log(`\ndone. Analyze with: npm run bot:analyze -- --reports ${dir}`);
  process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
}

// only run when executed directly (the tests import the helpers)
if (process.argv[1] && /arena\.ts$/.test(process.argv[1])) void main();
