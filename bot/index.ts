/**
 * AI player for the party game: connects over WebSocket like any phone and plays.
 *
 *   npm run bot -- --create --game ballistix --variant smashball --min-players 2
 *   npm run bot -- --code ABCD
 *   npm run bot -- --code ABCD --policy greedy --param aim=0.8 --matches 3
 */
import { hostname } from 'node:os';
import { seededIds } from '../src/core/server/minigames';
import { registerSourceGames } from '../src/core/server/plugins/sourceGames';
import { BotClient } from './core/client';
import { DEFAULT_BOT_GAME, coerceCliOptions } from './core/options';
import { registeredGames } from './core/registry';
import './games';

const argv = process.argv.slice(2);
const arg = (name: string, fallback = ''): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(`--${name}`);
const repeated = (name: string): [string, string][] =>
  argv.flatMap((a, i) => {
    if (a !== `--${name}` || !argv[i + 1]) return [];
    const [k, ...rest] = argv[i + 1].split('=');
    return [[k, rest.join('=')] as [string, string]];
  });

const USAGE = `usage: npm run bot -- (--create | --code CODE) [options]

--url URL            server websocket (default ws://localhost:8080/ws)
--create             create a room and host it (use with --game/--variant/--opt)
--code CODE          join an existing room (4 letters)
--password PW        room password
--name NAME          display name (default Bot-<random>)
--game ID            with --create: game family (default: ${DEFAULT_BOT_GAME})
--variant ID         with --create: variant, e.g. smashball, sand-orb, pulse-ball, cloud-orbs
--opt key=value      with --create: game option, repeatable
--min-players N      when hosting, start once N players are in and ready (default 2)
--start-delay MS     wait before START_GAME (default 3000)
--matches N          stop after N finished matches, 0 = forever (default 1)
--level NAME         difficulty preset (${[...new Set(registeredGames().flatMap((g) => Object.keys(g.levels ?? {})))].join(' | ')}); --param overrides it
--policy NAME        AI policy (${registeredGames().map((g) => `${g.id}: ${g.policies.join('|')}`).join('; ')})
--param key=value    policy tuning, repeatable (defaults are written into each report)
--seed N             random seed
--reports DIR        where reports go (default bot/reports)
-h, --help           this text`;

if (flag('help') || argv.includes('-h') || (!flag('create') && !arg('code'))) {
  console.log(USAGE);
  process.exit(flag('help') || argv.includes('-h') ? 0 : 1);
}

const level = arg('level') || undefined;
if (level && !registeredGames().some((g) => g.levels?.[level])) {
  console.error(`unknown level '${level}'`);
  process.exit(1);
}
if (!seededIds().length) await registerSourceGames();
const game = arg('game', DEFAULT_BOT_GAME);
const variant = arg('variant') || undefined;
const options = coerceCliOptions(repeated('opt'), game, variant);
const params: Record<string, number> = {};
for (const [k, v] of repeated('param')) params[k] = Number(v);

const client = new BotClient({
  url: arg('url', 'ws://localhost:8080/ws'),
  name: arg('name', `Bot-${Math.random().toString(36).slice(2, 5)}`),
  code: flag('create') ? undefined : arg('code').toUpperCase(),
  password: arg('password') || undefined,
  create: flag('create') ? { game, variant, options } : undefined,
  minPlayers: Number(arg('min-players', '2')),
  startDelayMs: Number(arg('start-delay', '3000')),
  resultsDelayMs: 3000,
  matches: Number(arg('matches', '1')),
  reportsDir: arg('reports', new URL('./reports', import.meta.url).pathname),
  policy: arg('policy') || undefined,
  level,
  params,
  seed: Number(arg('seed', String(Date.now() % 1e9))),
  log: (l) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${l}`),
});

process.on('SIGINT', () => client.stop());
process.on('SIGTERM', () => client.stop());
client.run().then(
  () => process.exit(0),
  (e) => {
    console.error(`bot failed on ${hostname()}: ${(e as Error).message}`);
    process.exit(1);
  },
);
