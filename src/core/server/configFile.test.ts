import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfigFile, parseArgs, parseConfigText, resolveConfigPath } from './configFile';

describe('parseArgs', () => {
  it('accepts -c, --config and --config=', () => {
    expect(parseArgs(['-c', 'a.yaml']).config).toBe('a.yaml');
    expect(parseArgs(['--config', 'b.yaml']).config).toBe('b.yaml');
    expect(parseArgs(['--config=c.yaml']).config).toBe('c.yaml');
    expect(parseArgs([])).toEqual({ help: false });
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });
  it('rejects a missing value and unknown flags with exit code 2', () => {
    for (const argv of [['-c'], ['--config'], ['-c', '--help'], ['--config='], ['--nope'], ['stray']]) {
      expect(() => parseArgs(argv), argv.join(' ')).toThrow(ConfigError);
      try {
        parseArgs(argv);
      } catch (e) {
        expect((e as ConfigError).exitCode).toBe(2);
      }
    }
  });
});

describe('resolveConfigPath', () => {
  const has = (...files: string[]) => (p: string) => files.includes(p);
  it('flag beats env beats the fixed location', () => {
    const env = { PARTY_GAME_CONFIG: '/env.yaml' };
    expect(resolveConfigPath({ config: '/flag.yaml' }, env, has('/flag.yaml', '/env.yaml', DEFAULT_CONFIG_PATH))).toEqual({ path: '/flag.yaml', source: 'flag' });
    expect(resolveConfigPath({}, env, has('/env.yaml', DEFAULT_CONFIG_PATH))).toEqual({ path: '/env.yaml', source: 'env' });
    expect(resolveConfigPath({}, {}, has(DEFAULT_CONFIG_PATH))).toEqual({ path: DEFAULT_CONFIG_PATH, source: 'default' });
  });
  it('is null when nothing is named and the fixed location is absent', () => {
    expect(resolveConfigPath({}, {}, has())).toBeNull();
  });
  it('a named file that does not exist is an error', () => {
    expect(() => resolveConfigPath({ config: '/missing.yaml' }, {}, has())).toThrow(/not found/);
    expect(() => resolveConfigPath({}, { PARTY_GAME_CONFIG: '/missing.yaml' }, has(DEFAULT_CONFIG_PATH))).toThrow(/PARTY_GAME_CONFIG/);
  });
});

describe('parseConfigText', () => {
  it('flattens namespaces to ServerConfig fields', () => {
    const o = parseConfigText(`
server: { port: 9000, trustProxy: true, adminToken: s3cret }
performance: { profile: low_power, maxRooms: 6 }
limits: { maxConnectionsPerIp: 0 }
storage: { store: memory, json: { dataDir: /var/lib/pg } }
`);
    expect(o).toEqual({
      port: 9000,
      trustProxy: true,
      adminToken: 's3cret',
      profile: 'LOW_POWER',
      maxRooms: 6,
      maxConnectionsPerIp: 0,
      profileStore: 'memory',
      dataDir: '/var/lib/pg',
    });
  });
  it('reads game.idleWarnSeconds and rejects a value out of range', () => {
    expect(loadConfig(parseConfigText('game: { idleWarnSeconds: 15 }')).idleWarnSeconds).toBe(15);
    expect(() => parseConfigText('game: { idleWarnSeconds: 7200 }')).toThrow(/idleWarnSeconds/);
  });
  it('durations are seconds in the file and milliseconds in ServerConfig', () => {
    const o = parseConfigText('limits: { joinTimeoutSeconds: 15, pingIntervalSeconds: 0 }\ngame: { idleRoomSeconds: 30 }');
    expect(o).toMatchObject({ joinTimeoutMs: 15_000, pingIntervalMs: 0, idleRoomSeconds: 30 });
    const cfg = loadConfig(o);
    expect(cfg.joinTimeoutMs).toBe(15_000);
    expect(cfg.pingIntervalMs).toBe(0);
  });
  it('rejects the old millisecond keys and reports ranges in seconds', () => {
    expect(() => parseConfigText('limits: { joinTimeoutMs: 5000 }')).toThrow(/limits\.joinTimeoutMs.*joinTimeoutSeconds/);
    expect(() => parseConfigText('limits: { pingIntervalSeconds: 601 }')).toThrow(/limits\.pingIntervalSeconds.*between 0 and 600/);
  });
  it('driver settings live under a subgroup named after the driver', () => {
    const o = parseConfigText(`
storage:
  store: sqlite
  maxProfiles: 50
  json: { dataDir: /srv/json }
  sqlite: { path: /srv/pg.db, busyTimeoutSeconds: 3 }
`);
    expect(o).toMatchObject({ profileStore: 'sqlite', maxProfiles: 50, dataDir: '/srv/json', sqlitePath: '/srv/pg.db', sqliteBusyTimeoutMs: 3000 });
  });
  it('rejects driver settings outside their subgroup and unknown keys inside it', () => {
    expect(() => parseConfigText('storage: { dataDir: /x }')).toThrow(/storage\.dataDir.*json, sqlite/);
    expect(parseConfigText('branding: { name: Bonk Night, welcomeMessage: Hi }')).toEqual({ brandName: 'Bonk Night', welcomeMessage: 'Hi' });
    expect(() => parseConfigText(`branding: { name: ${'x'.repeat(41)} }`)).toThrow(/branding\.name.*at most 40/);
    expect(() => parseConfigText('branding: { name: 5 }')).toThrow(/branding\.name.*string/);
    expect(() => parseConfigText('storage: { sqlite: { pth: x } }')).toThrow(/storage\.sqlite\.pth.*path, busyTimeoutSeconds/);
    expect(() => parseConfigText('storage: { mysql: {} }')).toThrow(/storage\.mysql/);
    expect(() => parseConfigText('storage: { sqlite: 5 }')).toThrow(/"storage\.sqlite" must be a mapping/);
    expect(() => parseConfigText('storage: { store: file }')).toThrow(/storage\.store.*json, sqlite, memory/);
  });
  it('empty documents and empty sections are fine', () => {
    expect(parseConfigText('')).toEqual({});
    expect(parseConfigText('# only a comment\n')).toEqual({});
    expect(parseConfigText('server:\n')).toEqual({});
  });
  it('names the dotted key in every error', () => {
    const cases: [string, RegExp][] = [
      ['server: { prot: 1 }', /server\.prot/],
      ['serverr: {}', /serverr/],
      ['server: 5', /"server" must be a mapping/],
      ['[1, 2]', /top level/],
      ['server: { port: abc }', /server\.port.*integer/],
      ['server: { port: 70000 }', /server\.port.*between 1 and 65535/],
      ['server: { trustProxy: 1 }', /server\.trustProxy.*true or false/],
      ['performance: { profile: TURBO }', /performance\.profile.*one of/],
      ['server: { host: 5 }', /server\.host.*string/],
      ['server: { port: [', /invalid YAML/],
    ];
    for (const [text, re] of cases) expect(() => parseConfigText(text, 'f.yaml'), text).toThrow(re);
  });
});

describe('loadConfigFile + loadConfig precedence', () => {
  const KEYS = ['MAX_ROOMS', 'PORT', 'PROFILE', 'TICK_RATE', 'NET_RATE', 'ADMIN_TOKEN', 'TRUST_PROXY', 'PROFILE_STORE', 'SQLITE_PATH', 'DATA_DIR'];
  const saved: Record<string, string | undefined> = {};
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pg-cfg-'));
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const file = (text: string) => {
    const p = join(dir, 'c.yaml');
    writeFileSync(p, text);
    return loadConfigFile(p);
  };

  it('a file duration overrides the millisecond env var', () => {
    process.env.PING_INTERVAL_MS = '1000';
    expect(loadConfig(file('limits: { pingIntervalSeconds: 20 }')).pingIntervalMs).toBe(20_000);
    expect(loadConfig(file('server: { port: 8080 }')).pingIntervalMs).toBe(1000);
    delete process.env.PING_INTERVAL_MS;
  });

  it('file beats env beats profile default', () => {
    process.env.MAX_ROOMS = '2';
    process.env.PORT = '9999';
    const cfg = loadConfig(file('performance: { maxRooms: 6 }'));
    expect(cfg.maxRooms).toBe(6); // file wins over env
    expect(cfg.port).toBe(9999); // env used when the file omits it
    expect(cfg.maxPlayersPerRoom).toBe(8); // profile default
  });
  it('the file profile sets the base rates and beats $PROFILE', () => {
    process.env.PROFILE = 'HIGH';
    const cfg = loadConfig(file('performance: { profile: LOW_POWER }'));
    expect(cfg.profile).toBe('LOW_POWER');
    expect(cfg.tickRate).toBe(30);
    expect(cfg.maxRooms).toBe(2);
  });
  it('networkRate is still snapped to a divisor of tickRate', () => {
    const cfg = loadConfig(file('performance: { tickRate: 60, networkRate: 25 }'));
    expect(60 % cfg.networkRate).toBe(0);
  });
  it('an empty string in the file means unset (config.example.yaml ships empty values, they must not hide the environment)', () => {
    process.env.ADMIN_TOKEN = 'envtoken';
    expect(loadConfig(file('server: { host: "" }')).host).toBe('0.0.0.0');
    expect(loadConfig(file('server: { adminToken: "" }')).adminToken).toBe('envtoken');
    expect(loadConfig(file('server: { trustProxy: false }')).trustProxy).toBe(false);
  });
  it('storage driver: env fallback, "file" alias, file wins', () => {
    process.env.PROFILE_STORE = 'sqlite';
    process.env.SQLITE_PATH = '/env/p.db';
    expect(loadConfig({})).toMatchObject({ profileStore: 'sqlite', sqlitePath: '/env/p.db' });
    expect(loadConfig(file('storage: { sqlite: { path: /file/p.db } }')).sqlitePath).toBe('/file/p.db');
    process.env.PROFILE_STORE = 'file';
    expect(loadConfig({}).profileStore).toBe('json');
    expect(loadConfig(file('storage: { store: memory }')).profileStore).toBe('memory');
  });
  it('no file leaves behaviour unchanged', () => {
    expect(loadConfig({})).toEqual(loadConfig());
  });
  it('an unreadable file is a ConfigError', () => {
    expect(() => loadConfigFile(join(dir, 'nope.yaml'))).toThrow(ConfigError);
  });
});
