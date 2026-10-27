import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadConfig, validateConfig, wsUrl } from './config';
import { authorized } from './http';
import { BotManager } from './manager';
import type { BotRunner, BotSpec, RunnerHooks } from './runner';

describe('config', () => {
  it('flags override file override env override defaults, and never touch DEFAULTS', () => {
    const c = loadConfig(['--max-bots', '3', '--level', 'hard', '--mixed'], { BOT_PORT: '9000', GAME_SERVER_URL: 'http://game:8080', BOT_MAX_BOTS: '5', BOT_MIN_HUMANS: '2' }).cfg;
    expect(c.join.maxBots).toBe(3); // flag beats env
    expect(c.join.minHumans).toBe(2); // env beats default
    expect(c.ai.level).toBe('hard');
    expect(c.ai.mixed).toBe('always');
    expect(c.server.port).toBe(9000);
    expect(c.gameServer.url).toBe('http://game:8080');
    expect(DEFAULTS.join.maxBots).toBe(8);
    expect(DEFAULTS.ai.mixed).toBe('never');
  });

  it('derives the websocket url and validates', () => {
    expect(wsUrl('https://x.org/')).toBe('wss://x.org/ws');
    expect(validateConfig(loadConfig([], {}).cfg)).toEqual([]);
    expect(validateConfig(loadConfig(['--host', '0.0.0.0'], {}).cfg)[0]).toMatch(/admin token/);
    expect(validateConfig(loadConfig(['--host', '0.0.0.0'], { ADMIN_TOKEN: 'x' }).cfg)).toEqual([]);
    expect(validateConfig(loadConfig(['--server', 'localhost'], {}).cfg)[0]).toMatch(/http/);
  });
});

describe('dashboard auth', () => {
  const req = (ip: string, headers: Record<string, string> = {}) => ({ headers, socket: { remoteAddress: ip } }) as never;

  it('without a token only the machine itself gets in', () => {
    expect(authorized('', req('127.0.0.1'))).toBe(true);
    expect(authorized('', req('10.0.0.5'))).toBe(false);
    expect(authorized('', req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' }))).toBe(false);
  });

  it('with a token it must match', () => {
    expect(authorized('s3', req('10.0.0.5', { authorization: 'Bearer s3' }))).toBe(true);
    expect(authorized('s3', req('127.0.0.1', { authorization: 'Bearer nope' }))).toBe(false);
    expect(authorized('s3', req('127.0.0.1'))).toBe(false);
  });
});

class FakeRunner implements BotRunner {
  started: { spec: BotSpec; hooks: RunnerHooks }[] = [];
  start(spec: BotSpec, hooks: RunnerHooks) {
    this.started.push({ spec, hooks });
    return {
      stop: (reason: string) => {
        hooks.onEvent({ kind: 'closed', reason });
        hooks.onExit();
      },
      usage: () => ({ cpu: 1.5, heapMB: 10, externalMB: 2 }),
    };
  }
}

describe('BotManager', () => {
  const plan = { gameId: 'ballistix', level: 'hard', policy: 'predictive', params: {} };
  const mk = (max = 2) => {
    const runner = new FakeRunner();
    const cfg = structuredClone(DEFAULTS);
    cfg.join.maxBots = max;
    cfg.reports.enabled = false;
    return { runner, m: new BotManager(runner, cfg) };
  };

  it('names bots, tracks their events and enforces the limit', () => {
    const { runner, m } = mk(2);
    const a = m.start('AAAA', plan, 'ballistix')!;
    const b = m.start('AAAA', plan, 'ballistix')!;
    expect([a.name, b.name]).toEqual(['Bot Hard', 'Bot Hard 2']);
    expect(m.start('BBBB', plan, 'ballistix')).toBeNull();
    runner.started[0].hooks.onEvent({ kind: 'joined', room: 'AAAA', id: 'x' });
    runner.started[0].hooks.onEvent({ kind: 'round', gameId: 'smashball', name: 'Smashball', variant: '', round: 1 });
    runner.started[0].hooks.onEvent({ kind: 'result', place: 2, points: 7 });
    expect(a).toMatchObject({ state: 'results', round: 'Smashball', lastPlace: 2, points: 7 });
    m.sampleUsage();
    expect(a.cpu).toBe(1.5);
    expect(a.heapMB + a.externalMB).toBe(12);
  });

  it('keeps ended bots in the table and frees the slot', () => {
    const { m } = mk(1);
    const a = m.start('AAAA', plan, 'ballistix')!;
    const seen: string[] = [];
    m.onEnded = (row) => seen.push(row.endReason);
    m.stopRoom('AAAA', 'no humans left');
    expect(a.state).toBe('ended');
    expect(seen).toEqual(['no humans left']);
    expect(m.count()).toBe(0);
    expect(m.start('AAAA', plan, 'ballistix')).not.toBeNull();
    expect(m.list().map((r) => r.state)).toEqual(['joining', 'ended']);
  });

  it('does not start bots while paused', () => {
    const { m } = mk();
    m.paused = true;
    expect(m.start('AAAA', plan, 'ballistix')).toBeNull();
  });
});
