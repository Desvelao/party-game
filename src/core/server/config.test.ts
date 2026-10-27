import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const KEYS = ['TICK_RATE', 'NET_RATE', 'MAX_PLAYERS', 'MAX_ROOMS', 'MAX_SPECTATORS', 'PROFILE', 'HOST', 'STATIC_DIR', 'ADMIN_TOKEN', 'TRUST_PROXY', 'JOIN_TIMEOUT_MS', 'PROFILE_STORE'];

describe('loadConfig empty-string env vars', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('resolves branding: file > env > default, cleaned and capped', () => {
    expect(loadConfig().brandName).toBe('Party Game');
    expect(loadConfig().welcomeMessage).toBe('');
    process.env.BRAND_NAME = '  Env  Name ';
    process.env.WELCOME_MESSAGE = 'x'.repeat(200);
    expect(loadConfig().brandName).toBe('Env Name');
    expect(loadConfig().welcomeMessage).toHaveLength(140);
    expect(loadConfig({ brandName: 'From file' }).brandName).toBe('From file');
    delete process.env.BRAND_NAME;
    delete process.env.WELCOME_MESSAGE;
  });

  it('treats empty strings like unset (NORMAL defaults)', () => {
    const unset = loadConfig();
    for (const k of KEYS) process.env[k] = '';
    const cfg = loadConfig();
    expect(cfg).toEqual(unset);
    expect(cfg.profile).toBe('NORMAL');
    expect(cfg.tickRate).toBe(60);
    expect(cfg.networkRate).toBe(20);
    expect(cfg.maxPlayersPerRoom).toBe(8);
    expect(cfg.maxRooms).toBe(4);
    expect(cfg.maxSpectatorsPerRoom).toBe(8);
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.staticDir).toBe('dist/client');
    expect(cfg.adminToken).toBe('');
  });
});

describe('loadConfig env parsing', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('accepts 1/true/yes (any case) for TRUST_PROXY and explicit off values', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    for (const v of ['1', 'true', 'TRUE', ' Yes ']) {
      process.env.TRUST_PROXY = v;
      expect(loadConfig({}, warn).trustProxy).toBe(true);
    }
    for (const v of ['0', 'false', 'No']) {
      process.env.TRUST_PROXY = v;
      expect(loadConfig({}, warn).trustProxy).toBe(false);
    }
    expect(warnings).toEqual([]);
    process.env.TRUST_PROXY = 'maybe';
    expect(loadConfig({}, warn).trustProxy).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('trims ADMIN_TOKEN, treats blank as unset, and never logs it', () => {
    const warnings: string[] = [];
    process.env.ADMIN_TOKEN = '  s3cret\n';
    expect(loadConfig({}, (m) => warnings.push(m)).adminToken).toBe('s3cret');
    process.env.ADMIN_TOKEN = ' \n';
    expect(loadConfig({}, (m) => warnings.push(m)).adminToken).toBe('');
    expect(loadConfig({ adminToken: ' tok \n' }).adminToken).toBe('tok');
    expect(warnings.join('')).not.toContain('s3cret');
    // an empty value in the config file (config.example.yaml ships one) must not hide ADMIN_TOKEN
    process.env.ADMIN_TOKEN = 'from-env';
    expect(loadConfig({ adminToken: '' }).adminToken).toBe('from-env');
    expect(loadConfig({ adminToken: 'from-file' }).adminToken).toBe('from-file');
  });

  it('warns when PROFILE or PROFILE_STORE is unknown, and falls back', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    process.env.PROFILE = 'turbo';
    process.env.PROFILE_STORE = 'sqlte';
    const cfg = loadConfig({}, warn);
    delete process.env.PROFILE_STORE;
    expect(cfg.profile).toBe('NORMAL');
    expect(cfg.profileStore).toBe('json');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('turbo');
    expect(warnings[1]).toContain('sqlte');
    warnings.length = 0;
    loadConfig({ profile: 'low_power', profileStore: 'sqlite' }, warn);
    expect(warnings).toEqual([]);
  });

  it('warns when an integer env value is invalid or clamped', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    process.env.MAX_ROOMS = 'lots';
    process.env.TICK_RATE = '500';
    process.env.MAX_PLAYERS = '12abc';
    const cfg = loadConfig({}, warn);
    delete process.env.MAX_ROOMS;
    delete process.env.TICK_RATE;
    delete process.env.MAX_PLAYERS;
    expect(cfg.maxRooms).toBe(4);
    expect(cfg.tickRate).toBe(120);
    expect(cfg.maxPlayersPerRoom).toBe(8);
    expect(warnings).toHaveLength(3);
    const all = warnings.join('\n');
    for (const k of ['MAX_ROOMS', 'TICK_RATE', 'MAX_PLAYERS']) expect(all).toContain(k);
  });
});
