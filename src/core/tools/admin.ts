/**
 * Command-line client of the admin API.
 *
 *   npm run admin -- rooms
 *   npm run admin -- kick ABCD 1a2b3c --ban --reason "spam" --minutes 60
 *   npm run admin -- config set maxRooms=6 maxSpectatorsPerRoom=3
 *
 * Connection: --url / ADMIN_URL (default http://127.0.0.1:8080), --token / ADMIN_TOKEN.
 * Without a token only a server on the same machine with no token set will answer.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TUNABLE_STR } from '../server/admin/runtimeConfig';
import { UsageError, flagValue, parseArgs as parseShared, type Parsed } from './args';

export { UsageError };

export interface Request {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** API prefix; default `/api/admin`. A plugin's admin routes live under `/api/<plugin id>`. */
  api?: string;
  body?: unknown;
  /** write the response body to this file instead of printing it */
  saveTo?: string;
}

export const USAGE = `usage: npm run admin -- [--url URL] [--token TOKEN] <command>

rooms | room <code> | close <code> | lock <code> [--off]
notice <code> <message...> | broadcast <message...> | rename <code> <playerId>
kick <code> <playerId> [--ban] [--ban-ip] [--reason TEXT] [--minutes N]
clients | bans | ban --ip IP | ban --profile ID [--reason TEXT] [--minutes N]
unban --ip IP | unban --profile ID
profiles [search] [--sort recent|created|wins|points|matches|name] [--limit N] [--offset N]
profile <id> | profile-rename <id> <name...> | profile-reset <id> | profile-delete <id>
export [file] | import <file>
config | config set key=value ... | config unset key ... | config reset
catalog | catalog disable <id...> | catalog enable <id...>
maintenance | maintenance on [--exit] [message...] | maintenance off | maintenance clear | maintenance remove <id> | maintenance clear-recent [id]
console | console new-pin | console unpair (console mode: the TV's pairing PIN and paired phones)
announce <message...> [--in SECONDS] [--for SECONDS] [--pin]
playlists | playlists set <id> <file.json> | playlists delete <id> | playlists restore <id>
defaults | defaults set <game|variant> opt=value... | defaults unset <game|variant> opt... | defaults reset [id]
progression [--limit N] | progression-show <id> | progression-reset <id> (progression plugin)
matches [--limit N] | leaderboard [--game ID] [--sort wins|points] [--limit N] | popularity
stats | status | metrics | audit [--limit N] | whoami`;

const VALUE_FLAGS = ['reason', 'minutes', 'sort', 'limit', 'offset', 'game', 'ip', 'profile', 'url', 'token', 'in', 'for'];
/** Flags that carry a number: checked when the request is built, so `--minutes abc` is a usage error, not NaN. */
const NUMBER_FLAGS = ['minutes', 'limit', 'offset', 'in', 'for'];

export const parseArgs = (argv: string[]): Parsed => parseShared(argv, VALUE_FLAGS);

const q = (params: Record<string, string | undefined>) => {
  const e = Object.entries(params).filter((p): p is [string, string] => p[1] !== undefined);
  return e.length ? '?' + new URLSearchParams(e).toString() : '';
};

function need(words: string[], n: number, what: string): string[] {
  if (words.length < n) throw new UsageError(`missing ${what}`);
  return words;
}

const flag = (p: Parsed, name: string): string | undefined => {
  const v = flagValue(p, name);
  if (v !== undefined && NUMBER_FLAGS.includes(name) && (v.trim() === '' || !Number.isFinite(Number(v)))) throw new UsageError(`--${name} takes a number, got "${v}"`);
  return v;
};

/** `key=value` pairs from the command line: text for the text settings (brand, welcome message), integers otherwise. */
function settingsFrom(pairs: string[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of pairs) {
    const m = /^([A-Za-z]+)=(.*)$/s.exec(p);
    if (!m) throw new UsageError(`expected key=value, got "${p}"`);
    const [, key, value] = m as unknown as [string, string, string];
    if ((TUNABLE_STR as readonly string[]).includes(key)) out[key] = value;
    else if (/^-?\d+$/.test(value)) out[key] = Number(value);
    else throw new UsageError(`expected key=number, got "${p}"`);
  }
  return out;
}

/** Turns command-line words into one API request. Pure apart from `readFile` (used by `import`). */
export function buildRequest(argv: string[], readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): Request {
  const p = parseArgs(argv);
  const [cmd, ...rest] = p.words;
  const enc = encodeURIComponent;
  const page = { limit: flag(p, 'limit'), offset: flag(p, 'offset') };

  switch (cmd) {
    case 'whoami':
      return { method: 'GET', path: '/whoami' };
    case 'stats':
      return { method: 'GET', path: '/stats' };
    case 'status':
      return { method: 'GET', path: '/status' };
    case 'metrics':
      return { method: 'GET', path: '/metrics' };
    case 'audit':
      return { method: 'GET', path: '/audit' + q({ limit: flag(p, 'limit') }) };
    case 'rooms':
      return { method: 'GET', path: '/rooms' };
    case 'room':
      return { method: 'GET', path: `/rooms/${enc(need(rest, 1, 'room code')[0]!)}` };
    case 'close':
      return { method: 'POST', path: `/rooms/${enc(need(rest, 1, 'room code')[0]!)}/close`, body: {} };
    case 'lock':
      return { method: 'POST', path: `/rooms/${enc(need(rest, 1, 'room code')[0]!)}/lock`, body: { locked: !p.flags.has('off') } };
    case 'notice': {
      const [code, ...msg] = need(rest, 2, 'room code and message');
      return { method: 'POST', path: `/rooms/${enc(code!)}/broadcast`, body: { message: msg.join(' ') } };
    }
    case 'broadcast':
      return { method: 'POST', path: '/broadcast', body: { message: need(rest, 1, 'message').join(' ') } };
    case 'rename': {
      const [code, id] = need(rest, 2, 'room code and player id');
      return { method: 'POST', path: `/rooms/${enc(code!)}/rename`, body: { id } };
    }
    case 'kick': {
      const [code, id] = need(rest, 2, 'room code and player id');
      const minutes = flag(p, 'minutes');
      return {
        method: 'POST',
        path: `/rooms/${enc(code!)}/kick`,
        body: {
          id,
          ...(p.flags.has('ban') ? { ban: true } : {}),
          ...(p.flags.has('ban-ip') ? { banIp: true } : {}),
          ...(flag(p, 'reason') ? { reason: flag(p, 'reason') } : {}),
          ...(minutes ? { minutes: Number(minutes) } : {}),
        },
      };
    }
    case 'clients':
      return { method: 'GET', path: '/clients' };
    case 'bans':
      return { method: 'GET', path: '/bans' };
    case 'ban':
    case 'unban': {
      const ip = flag(p, 'ip');
      const profile = flag(p, 'profile');
      if (!ip === !profile) throw new UsageError('give exactly one of --ip, --profile');
      if (cmd === 'unban') return { method: 'DELETE', path: '/bans' + q(ip ? { ip } : { profileId: profile }) };
      const minutes = flag(p, 'minutes');
      return {
        method: 'POST',
        path: '/bans',
        body: {
          ...(ip ? { ip } : { profileId: profile }),
          ...(flag(p, 'reason') ? { reason: flag(p, 'reason') } : {}),
          ...(minutes ? { minutes: Number(minutes) } : {}),
        },
      };
    }
    case 'profiles':
      return { method: 'GET', path: '/profiles' + q({ q: rest.join(' ') || undefined, sort: flag(p, 'sort'), ...page }) };
    case 'profile':
      return { method: 'GET', path: `/profiles/${enc(need(rest, 1, 'profile id')[0]!)}` };
    case 'profile-rename': {
      const [id, ...name] = need(rest, 2, 'profile id and name');
      return { method: 'PATCH', path: `/profiles/${enc(id!)}`, body: { name: name.join(' ') } };
    }
    case 'profile-reset':
      return { method: 'POST', path: `/profiles/${enc(need(rest, 1, 'profile id')[0]!)}/reset-stats`, body: {} };
    case 'profile-delete':
      return { method: 'DELETE', path: `/profiles/${enc(need(rest, 1, 'profile id')[0]!)}` };
    case 'progression':
      return { method: 'GET', api: '/api/progression', path: '/' + q({ limit: flag(p, 'limit') }) };
    case 'progression-show':
      return { method: 'GET', api: '/api/progression', path: `/${enc(need(rest, 1, 'profile id')[0]!)}` };
    case 'progression-reset':
      return { method: 'POST', api: '/api/progression', path: `/${enc(need(rest, 1, 'profile id')[0]!)}/reset`, body: {} };
    case 'export':
      return { method: 'GET', path: '/profiles/export', ...(rest[0] ? { saveTo: rest[0] } : {}) };
    case 'import': {
      const file = need(rest, 1, 'file')[0]!;
      let data: unknown;
      try {
        data = JSON.parse(readFile(file));
      } catch (err) {
        throw new UsageError(`cannot read ${file}: ${(err as Error).message}`);
      }
      // accept the export file as is, or a bare { id: record } map
      const profiles = (data as { profiles?: unknown })?.profiles ?? data;
      return { method: 'POST', path: '/profiles/import', body: { profiles } };
    }
    case 'config': {
      const [sub, ...args] = rest;
      if (!sub) return { method: 'GET', path: '/config' };
      if (sub === 'reset') return { method: 'DELETE', path: '/config' };
      if (sub === 'set') return { method: 'PATCH', path: '/config', body: settingsFrom(need(args, 1, 'key=value')) };
      if (sub === 'unset') {
        return { method: 'PATCH', path: '/config', body: Object.fromEntries(need(args, 1, 'setting name').map((k) => [k, null])) };
      }
      throw new UsageError(`unknown config command "${sub}"`);
    }
    case 'catalog': {
      const [sub, ...ids] = rest;
      if (!sub) return { method: 'GET', path: '/catalog' };
      if (sub === 'disable') return { method: 'PATCH', path: '/catalog', body: { disable: need(ids, 1, 'game or variant id') } };
      if (sub === 'enable') return { method: 'PATCH', path: '/catalog', body: { enable: need(ids, 1, 'game or variant id') } };
      throw new UsageError(`unknown catalog command "${sub}"`);
    }
    case 'console': {
      const [sub] = rest;
      if (!sub) return { method: 'GET', path: '/console' };
      if (sub === 'new-pin') return { method: 'POST', path: '/console/pin' };
      if (sub === 'unpair') return { method: 'POST', path: '/console/unpair' };
      throw new UsageError(`unknown console command "${sub}"`);
    }
    case 'maintenance': {
      const [sub, ...args] = rest;
      if (!sub) return { method: 'GET', path: '/maintenance' };
      if (sub === 'on') return { method: 'PUT', path: '/maintenance', body: { draining: true, exitWhenEmpty: p.flags.has('exit'), ...(args.length ? { message: args.join(' ') } : {}) } };
      if (sub === 'off') return { method: 'PUT', path: '/maintenance', body: { draining: false } };
      if (sub === 'clear') return { method: 'DELETE', path: '/maintenance' };
      if (sub === 'remove') return { method: 'DELETE', path: `/maintenance/announce/${enc(need(args, 1, 'announcement id')[0]!)}` };
      if (sub === 'clear-recent') return { method: 'DELETE', path: args.length ? `/maintenance/recent/${enc(args[0]!)}` : '/maintenance/recent' };
      throw new UsageError(`unknown maintenance command "${sub}"`);
    }
    case 'announce': {
      const inSeconds = flag(p, 'in');
      const forSeconds = flag(p, 'for');
      return {
        method: 'POST',
        path: '/maintenance/announce',
        body: { message: need(rest, 1, 'message').join(' '), pinned: p.flags.has('pin'), ...(inSeconds ? { inSeconds: Number(inSeconds) } : {}), ...(forSeconds ? { durationSeconds: Number(forSeconds) } : {}) },
      };
    }
    case 'playlists': {
      const [sub, id, file] = rest;
      if (!sub) return { method: 'GET', path: '/playlists' };
      const pid = need([id ?? ''].filter(Boolean), 1, 'playlist id')[0]!;
      if (sub === 'delete') return { method: 'DELETE', path: `/playlists/${enc(pid)}` };
      if (sub === 'restore') return { method: 'POST', path: `/playlists/${enc(pid)}/restore`, body: {} };
      if (sub === 'set') {
        const path = need([file ?? ''].filter(Boolean), 1, 'file with {name, rounds}')[0]!;
        let body: unknown;
        try {
          body = JSON.parse(readFile(path));
        } catch (err) {
          throw new UsageError(`cannot read ${path}: ${(err as Error).message}`);
        }
        return { method: 'PUT', path: `/playlists/${enc(pid)}`, body };
      }
      throw new UsageError(`unknown playlists command "${sub}"`);
    }
    case 'defaults': {
      const [sub, id, ...args] = rest;
      if (!sub) return { method: 'GET', path: '/defaults' };
      if (sub === 'reset') return { method: 'DELETE', path: '/defaults' + q({ id }) };
      if (sub === 'set') {
        const options: Record<string, number | boolean | string> = {};
        for (const pair of need(args, 1, 'option=value')) {
          const m = /^([A-Za-z0-9_]+)=(.+)$/.exec(pair);
          if (!m) throw new UsageError(`expected option=value, got "${pair}"`);
          const v = m[2]!;
          options[m[1]!] = v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        }
        return { method: 'PATCH', path: '/defaults', body: { id: need([id ?? ''].filter(Boolean), 1, 'game or variant id')[0], options } };
      }
      if (sub === 'unset') {
        const names = need(args, 1, 'option name');
        return { method: 'PATCH', path: '/defaults', body: { id: need([id ?? ''].filter(Boolean), 1, 'game or variant id')[0], options: Object.fromEntries(names.map((k) => [k, null])) } };
      }
      throw new UsageError(`unknown defaults command "${sub}"`);
    }
    case 'matches':
      return { method: 'GET', path: '/matches' + q({ limit: flag(p, 'limit') }) };
    case 'leaderboard':
      return { method: 'GET', path: '/leaderboard' + q({ game: flag(p, 'game'), sort: flag(p, 'sort'), limit: flag(p, 'limit') }) };
    case 'popularity':
      return { method: 'GET', path: '/popularity' };
    case undefined:
      throw new UsageError('missing command');
    default:
      throw new UsageError(`unknown command "${cmd}"`);
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { words, flags } = parseArgs(argv);
  if (argv.length === 0 || flags.has('help') || words[0] === 'help') {
    console.log(USAGE);
    return argv.length === 0 ? 2 : 0;
  }
  const base = String(flags.get('url') ?? process.env.ADMIN_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const token = String(flags.get('token') ?? process.env.ADMIN_TOKEN ?? '');
  const req = buildRequest(argv);

  let res: Response;
  try {
    res = await fetch(`${base}${req.api ?? '/api/admin'}${req.path}`, {
      method: req.method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
  } catch (err) {
    console.error(`cannot reach ${base}: ${(err as Error).message}`);
    return 1;
  }
  const text = await res.text();
  let out = text;
  try {
    out = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    /* not JSON: print as is */
  }
  if (!res.ok) {
    console.error(`${res.status} ${out}`);
    return 1;
  }
  if (req.saveTo) {
    writeFileSync(req.saveTo, out + '\n');
    console.error(`saved to ${req.saveTo}`);
  } else console.log(out);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
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
