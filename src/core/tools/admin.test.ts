import { describe, expect, it } from 'vitest';
import { UsageError, buildRequest, parseArgs } from './admin';

describe('admin CLI', () => {
  it('parses flags with and without values', () => {
    const p = parseArgs(['kick', 'ABCD', 'x1', '--ban', '--reason', 'spam it', '--minutes=30']);
    expect(p.words).toEqual(['kick', 'ABCD', 'x1']);
    expect(p.flags.get('ban')).toBe(true);
    expect(p.flags.get('reason')).toBe('spam it');
    expect(p.flags.get('minutes')).toBe('30');
    expect(() => parseArgs(['--reason'])).toThrow(UsageError);
  });

  it('treats help flags only as flags, and -- ends options', () => {
    expect(parseArgs(['rooms', '-h']).flags.get('help')).toBe(true);
    expect(parseArgs(['rooms', '--help']).flags.get('help')).toBe(true);
    // a flag's value is consumed even when it looks like a flag
    const v = parseArgs(['kick', 'AB12', 'p1', '--reason', '-h']);
    expect(v.flags.has('help')).toBe(false);
    expect(v.flags.get('reason')).toBe('-h');
    expect(parseArgs(['--reason', '--help']).flags.get('reason')).toBe('--help');
    // after `--` everything is positional
    const d = parseArgs(['notice', 'AB12', '--', '-h', '--ban', '--']);
    expect(d.words).toEqual(['notice', 'AB12', '-h', '--ban', '--']);
    expect(d.flags.size).toBe(0);
    expect(buildRequest(['notice', 'AB12', '--', '--help']).body).toEqual({ message: '--help' });
  });

  it('maps room commands', () => {
    expect(buildRequest(['rooms'])).toEqual({ method: 'GET', path: '/rooms' });
    expect(buildRequest(['status'])).toEqual({ method: 'GET', path: '/status' });
    expect(buildRequest(['close', 'AB12'])).toMatchObject({ method: 'POST', path: '/rooms/AB12/close' });
    expect(buildRequest(['lock', 'AB12', '--off']).body).toEqual({ locked: false });
    expect(buildRequest(['lock', 'AB12']).body).toEqual({ locked: true });
    expect(buildRequest(['notice', 'AB12', 'Pizza', 'is', 'here']).body).toEqual({ message: 'Pizza is here' });
    expect(buildRequest(['kick', 'AB12', 'p1', '--ban', '--ban-ip', '--minutes', '60', '--reason', 'rude']).body).toEqual({
      id: 'p1',
      ban: true,
      banIp: true,
      reason: 'rude',
      minutes: 60,
    });
  });

  it('maps bans and requires exactly one target', () => {
    expect(buildRequest(['ban', '--ip', '1.2.3.4', '--minutes', '5'])).toMatchObject({ method: 'POST', path: '/bans', body: { ip: '1.2.3.4', minutes: 5 } });
    expect(buildRequest(['unban', '--profile', 'abc'])).toEqual({ method: 'DELETE', path: '/bans?profileId=abc' });
    expect(() => buildRequest(['ban'])).toThrow(UsageError);
    expect(() => buildRequest(['ban', '--ip', 'a', '--profile', 'b'])).toThrow(UsageError);
  });

  it('maps the progression plugin commands to its own API prefix', () => {
    expect(buildRequest(['progression', '--limit', '5'])).toEqual({ method: 'GET', api: '/api/progression', path: '/?limit=5' });
    expect(buildRequest(['progression-show', 'abc'])).toEqual({ method: 'GET', api: '/api/progression', path: '/abc' });
    expect(buildRequest(['progression-reset', 'abc'])).toEqual({ method: 'POST', api: '/api/progression', path: '/abc/reset', body: {} });
    expect(() => buildRequest(['progression-reset'])).toThrow(UsageError);
  });

  it('maps profiles, config and catalog', () => {
    expect(buildRequest(['profiles', 'ann', 'lee', '--sort', 'wins', '--limit', '5']).path).toBe('/profiles?q=ann+lee&sort=wins&limit=5');
    expect(buildRequest(['config', 'set', 'maxRooms=6', 'maxSpectatorsPerRoom=3']).body).toEqual({ maxRooms: 6, maxSpectatorsPerRoom: 3 });
    expect(buildRequest(['config', 'unset', 'maxRooms']).body).toEqual({ maxRooms: null });
    expect(buildRequest(['config', 'reset'])).toEqual({ method: 'DELETE', path: '/config' });
    expect(buildRequest(['catalog', 'disable', 'box-bonanza', 'frost-classic']).body).toEqual({ disable: ['box-bonanza', 'frost-classic'] });
    expect(() => buildRequest(['config', 'set', 'maxRooms=lots'])).toThrow(UsageError);
  });

  it('sets text settings as text and keeps numbers for the rest', () => {
    expect(buildRequest(['config', 'set', 'brandName=Bonk Night', 'welcomeMessage=', 'maxRooms=6']).body).toEqual({ brandName: 'Bonk Night', welcomeMessage: '', maxRooms: 6 });
    expect(buildRequest(['config', 'set', 'brandName=a=b']).body).toEqual({ brandName: 'a=b' });
    expect(() => buildRequest(['config', 'set', 'brandName'])).toThrow(UsageError);
  });

  it('rejects number flags that are not numbers', () => {
    expect(() => buildRequest(['kick', 'AB12', 'p1', '--minutes', 'abc'])).toThrow(/--minutes takes a number/);
    expect(() => buildRequest(['ban', '--ip', '1.2.3.4', '--minutes='])).toThrow(UsageError);
    expect(() => buildRequest(['profiles', '--limit', 'x'])).toThrow(UsageError);
    expect(() => buildRequest(['matches', '--limit', '10x'])).toThrow(UsageError);
    expect(buildRequest(['matches', '--limit', '10']).path).toBe('/matches?limit=10');
  });

  it('maps console', () => {
    expect(buildRequest(['console'])).toEqual({ method: 'GET', path: '/console' });
    expect(buildRequest(['console', 'new-pin'])).toEqual({ method: 'POST', path: '/console/pin' });
    expect(buildRequest(['console', 'unpair'])).toEqual({ method: 'POST', path: '/console/unpair' });
    expect(() => buildRequest(['console', 'nope'])).toThrow();
  });
  it('maps maintenance and announce', () => {
    expect(buildRequest(['maintenance'])).toEqual({ method: 'GET', path: '/maintenance' });
    expect(buildRequest(['maintenance', 'on', '--exit', 'Back', 'at', '8'])).toEqual({ method: 'PUT', path: '/maintenance', body: { draining: true, exitWhenEmpty: true, message: 'Back at 8' } });
    expect(buildRequest(['maintenance', 'on']).body).toEqual({ draining: true, exitWhenEmpty: false });
    expect(buildRequest(['maintenance', 'off']).body).toEqual({ draining: false });
    expect(buildRequest(['maintenance', 'clear'])).toEqual({ method: 'DELETE', path: '/maintenance' });
    expect(buildRequest(['maintenance', 'remove', 'abc1']).path).toBe('/maintenance/announce/abc1');
    expect(buildRequest(['maintenance', 'clear-recent'])).toEqual({ method: 'DELETE', path: '/maintenance/recent' });
    expect(buildRequest(['maintenance', 'clear-recent', 'abc1'])).toEqual({ method: 'DELETE', path: '/maintenance/recent/abc1' });
    expect(buildRequest(['announce', 'Closing', 'soon', '--in', '600', '--for', '3600', '--pin']).body).toEqual({ message: 'Closing soon', pinned: true, inSeconds: 600, durationSeconds: 3600 });
    expect(buildRequest(['announce', 'Hi']).body).toEqual({ message: 'Hi', pinned: false });
    expect(() => buildRequest(['announce', 'Hi', '--in', 'soon'])).toThrow(UsageError);
    expect(() => buildRequest(['maintenance', 'later'])).toThrow(UsageError);
  });

  it('import accepts an export file or a bare map', () => {
    const files: Record<string, string> = { a: '{"version":1,"profiles":{"x":{}}}', b: '{"y":{}}' };
    expect(buildRequest(['import', 'a'], (f) => files[f]!).body).toEqual({ profiles: { x: {} } });
    expect(buildRequest(['import', 'b'], (f) => files[f]!).body).toEqual({ profiles: { y: {} } });
    expect(() => buildRequest(['import', 'nope'], () => '{bad')).toThrow(UsageError);
    expect(buildRequest(['export', 'out.json']).saveTo).toBe('out.json');
  });

  it('rejects unknown commands', () => {
    expect(() => buildRequest(['frobnicate'])).toThrow(/unknown command/);
    expect(() => buildRequest([])).toThrow(/missing command/);
  });
});
