import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../games';
import { AiRouter } from '../router/router';
import { AuditLog } from './audit';
import { loadConfig } from './config';
import { describeConfig } from './check';
import { renderExample } from './gen-config-example';
import { RuntimeConfig } from './runtimeConfig';
import { ConfigError, SETTINGS, defaultConfig, parseArgs, parseConfigText, resolveConfig, resolveConfigPath, key } from './settings';

const games = () => new AiRouter({ level: 'normal' }).catalog().map((g) => ({ id: g.id, levels: g.levels, policies: g.policies }));

describe('command line', () => {
  it('knows -c, --check, -h and the extra flags, and rejects the rest', () => {
    expect(parseArgs(['-c', 'a.yaml', '--check'])).toMatchObject({ config: 'a.yaml', check: true });
    expect(parseArgs(['--config=b.yaml']).config).toBe('b.yaml');
    expect(parseArgs(['--port', '9']).flags.get('server.port')).toBe('9');
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['-c'])).toThrow(/needs a file path/);
    expect(() => parseArgs(['--port'])).toThrow(/needs a value/);
    expect(() => loadConfig(['--port', 'abc'], {})).toThrow(ConfigError);
  });

  it('finds the config file: flag, then $BOT_SERVER_CONFIG, then the default location', () => {
    const exists = (p: string) => p !== '/missing.yaml';
    expect(resolveConfigPath({ config: 'x.yaml' }, {}, exists)).toEqual({ path: 'x.yaml', source: 'flag' });
    expect(resolveConfigPath({}, { BOT_SERVER_CONFIG: 'e.yaml' }, exists)).toEqual({ path: 'e.yaml', source: 'env' });
    expect(resolveConfigPath({}, {}, () => false)).toBeNull();
    expect(resolveConfigPath({}, {}, exists, '/d.yaml')).toEqual({ path: '/d.yaml', source: 'default' });
    expect(() => resolveConfigPath({ config: '/missing.yaml' }, {}, exists)).toThrow(/not found/);
  });
});

describe('config file and environment', () => {
  it('file beats environment beats default', () => {
    const file = parseConfigText('join:\n  maxBots: 2\nai:\n  level: hard\n  levels:\n    ballistix: easy\n');
    const r = resolveConfig(parseArgs([]), file, { BOT_MAX_BOTS: '6', BOT_MIN_HUMANS: '3', BOT_LEVEL: 'easy' });
    expect(r.cfg.join.maxBots).toBe(2);
    expect(r.cfg.join.minHumans).toBe(3);
    expect(r.cfg.ai.level).toBe('hard');
    expect(r.cfg.ai.levels).toEqual({ ballistix: 'easy' });
    expect(r.sources.get('join.maxBots')).toBe('file');
    expect(r.sources.get('join.minHumans')).toBe('env');
    expect(r.sources.get('join.pollSeconds')).toBe('default');
  });

  it('is strict about the file, with one-line messages', () => {
    expect(() => parseConfigText('join:\n  maxBots: 999\n', 'f.yaml')).toThrow('f.yaml: join.maxBots must be between 0 and 64 (got 999)');
    expect(() => parseConfigText('join:\n  maxBots: "x"\n', 'f.yaml')).toThrow(/must be an integer/);
    expect(() => parseConfigText('nope: 1\n', 'f.yaml')).toThrow('f.yaml: unknown setting "nope"');
    expect(() => parseConfigText('join:\n  nope: 1\n', 'f.yaml')).toThrow('unknown setting "join.nope"');
    expect(() => parseConfigText('ai:\n  mixed: sometimes\n')).toThrow(/one of never, always/);
    expect(() => parseConfigText('ai:\n  params:\n    aim: high\n')).toThrow(/must be a number/);
    expect(() => parseConfigText('- a\n')).toThrow(/mapping/);
    expect(parseConfigText('').scalars.size).toBe(0);
  });

  it('clamps or ignores bad environment values with a warning', () => {
    const r = resolveConfig(parseArgs([]), null, { BOT_MAX_BOTS: '1000', BOT_POLL_SECONDS: 'x', BOT_METRICS: 'maybe', BOT_MIXED: 'sometimes' });
    expect(r.cfg.join.maxBots).toBe(64);
    expect(r.cfg.join.pollSeconds).toBe(3);
    expect(r.cfg.metrics.enabled).toBe(true);
    expect(r.cfg.ai.mixed).toBe('never');
    expect(r.warnings).toHaveLength(4);
  });

  it('uses ADMIN_TOKEN for the dashboard, BOT_TOKEN as a deprecated alias, and shares it with the game server', () => {
    const a = resolveConfig(parseArgs([]), null, { ADMIN_TOKEN: 'tok' });
    expect(a.cfg.server.adminToken).toBe('tok');
    expect(a.cfg.gameServer.adminToken).toBe('tok');
    const b = resolveConfig(parseArgs([]), null, { BOT_TOKEN: 'old', GAME_SERVER_ADMIN_TOKEN: 'game' });
    expect(b.cfg.server.adminToken).toBe('old');
    expect(b.cfg.gameServer.adminToken).toBe('game');
    expect(b.warnings[0]).toMatch(/BOT_TOKEN is deprecated, use ADMIN_TOKEN/);
  });

  it('--check masks secrets and shows sources', () => {
    const l = { ...resolveConfig(parseArgs([]), null, { ADMIN_TOKEN: 'secret' }), file: null };
    const text = describeConfig(l).join('\n');
    expect(text).not.toContain('secret');
    expect(text).toMatch(/server\.adminToken\s+\(set\)\s+env/);
  });
});

describe('config.example.yaml', () => {
  const example = readFileSync(new URL('./config.example.yaml', import.meta.url), 'utf8');

  it('is up to date with the schema (run: npm run bot:config:example)', () => {
    expect(example).toBe(renderExample());
  });

  it('parses as a valid config that equals the defaults', () => {
    const parsed = parseConfigText(example);
    const r = resolveConfig(parseArgs([]), parsed, {});
    expect(r.cfg).toEqual(defaultConfig());
    expect(SETTINGS.every((d) => example.includes(`${d.path[d.path.length - 1]}:`))).toBe(true);
    expect(SETTINGS.filter((d) => d.env.length).length).toBe(SETTINGS.length);
    expect(new Set(SETTINGS.map((d) => key(d.path))).size).toBe(SETTINGS.length);
  });
});

describe('RuntimeConfig', () => {
  const make = (dir: string | null, onChange = () => {}) => {
    const cfg = defaultConfig();
    return { cfg, rt: new RuntimeConfig(cfg, dir, games, onChange) };
  };

  it('applies live settings in place, all or nothing, and can reset one or all', () => {
    const { cfg, rt } = make(null);
    expect(rt.patch({ 'join.maxBots': 2, 'ai.level': 'hard', 'metrics.enabled': false })).toEqual({ ok: true });
    expect(cfg.join.maxBots).toBe(2);
    expect(cfg.ai.level).toBe('hard');
    expect(cfg.metrics.enabled).toBe(false);
    const bad = rt.patch({ 'join.maxBots': 3, 'join.pollSeconds': 0 });
    expect(bad).toEqual({ ok: false, errors: { 'join.pollSeconds': 'must be between 1 and 300 (got 0)' } });
    expect(cfg.join.maxBots).toBe(2);
    expect(rt.snapshot().overridden.sort()).toEqual(['ai.level', 'join.maxBots', 'metrics.enabled']);
    rt.patch({ 'join.maxBots': null });
    expect(cfg.join.maxBots).toBe(8);
    rt.reset();
    expect(cfg.ai.level).toBe('normal');
    expect(cfg.metrics.enabled).toBe(true);
  });

  it('rejects restart-only and unknown settings, bad levels and policies', () => {
    const { rt } = make(null);
    expect(rt.patch({ 'server.port': 1 })).toEqual({ ok: false, errors: { 'server.port': 'needs a restart' } });
    expect(rt.patch({ nope: 1 })).toEqual({ ok: false, errors: { nope: 'unknown setting' } });
    expect((rt.patch({ 'ai.level': 'godlike' }) as { errors: Record<string, string> }).errors['ai.level']).toMatch(/unknown level/);
    expect((rt.patch({ 'ai.levels': { 'no-such-game': 'hard' } }) as { errors: Record<string, string> }).errors['ai.levels']).toMatch(/no AI for no-such-game/);
    expect((rt.patch({ 'ai.levels': { ballistix: 'godlike' } }) as { errors: Record<string, string> }).errors['ai.levels']).toMatch(/not one of/);
    expect(rt.patch({ 'ai.levels': { ballistix: 'hard' }, 'ai.policies': { ballistix: 'greedy' }, 'ai.params': { aim: 0.8 } })).toEqual({ ok: true });
  });

  it('the router and the manager see changes at once because they share the config object', () => {
    const { cfg, rt } = make(null);
    const router = new AiRouter(cfg.ai);
    expect(router.plan({ game: 'ballistix' })?.level).toBe('normal');
    rt.patch({ 'ai.levels': { ballistix: 'expert' }, 'ai.params': { noise: 7 } });
    expect(router.plan({ game: 'ballistix' })).toMatchObject({ level: 'expert', params: { noise: 7 } });
    rt.patch({ 'ai.mixed': 'always' });
    expect(router.supports({ game: 'mixed' }).ok).toBe(true);
  });

  it('keeps overrides across restarts and calls onChange', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-rt-'));
    try {
      let changes = 0;
      const a = make(dir, () => changes++);
      const base = changes;
      a.rt.patch({ 'join.botsPerRoom': 3 });
      expect(changes).toBe(base + 1);
      await a.rt.flush();
      const b = make(dir);
      expect(b.cfg.join.botsPerRoom).toBe(3);
      expect(b.rt.snapshot().defaults['join.botsPerRoom']).toBe(1);
      b.rt.reset();
      await b.rt.flush();
      expect(make(dir).cfg.join.botsPerRoom).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows secrets as set/unset in the restart-only list', () => {
    const { cfg, rt } = make(null);
    cfg.server.adminToken = 'hunter2';
    const r = rt.snapshot().restartOnly;
    expect(r['server.adminToken']).toBe('(set)');
    expect(r['gameServer.adminToken']).toBe('(unset)');
    expect(JSON.stringify(rt.snapshot())).not.toContain('hunter2');
  });
});

describe('AuditLog', () => {
  it('keeps the newest first and survives a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-audit-'));
    try {
      const a = new AuditLog(dir);
      a.record({ action: 'config.set', ip: '1.1.1.1', detail: { x: 1 } });
      a.record({ action: 'bot.stop', ip: '1.1.1.1', target: 'Bot Hard @ ABCD' });
      expect(a.list().map((e) => e.action)).toEqual(['bot.stop', 'config.set']);
      expect(new AuditLog(dir).list()).toHaveLength(2);
      writeFileSync(join(dir, 'audit.jsonl'), 'garbage\n');
      expect(new AuditLog(dir).list()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
