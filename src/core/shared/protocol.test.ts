import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, rejectedJoinError, normalizeRoomCode, parseClientMessage, sanitizeName } from './protocol';
import { generateRoomCodeForTest } from './testutil';

describe('GAME_ACTION', () => {
  const parse = (data: unknown) => parseClientMessage(JSON.stringify({ t: 'GAME_ACTION', data }));
  it('passes a small plain object through', () => {
    expect(parse({ a: 'play', card: 3, targets: [1, 2], nested: { ok: true } })).toEqual({
      t: 'GAME_ACTION',
      data: { a: 'play', card: 3, targets: [1, 2], nested: { ok: true } },
    });
  });
  it('rejects non-objects, oversized, too deep and too wide data', () => {
    expect(parse('x')).toBeNull();
    expect(parse([1])).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse({ s: 'x'.repeat(600) })).toBeNull();
    expect(parse({ a: { b: { c: { d: 1 } } } })).toBeNull();
    expect(parse(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])))).toBeNull();
    expect(parseClientMessage('{"t":"GAME_ACTION"}')).toBeNull();
    expect(parseClientMessage('{"t":"BACK_TO_LOBBY"}')).toEqual({ t: 'BACK_TO_LOBBY' });
  });
  it('drops a __proto__ key instead of polluting', () => {
    expect(parseClientMessage('{"t":"GAME_ACTION","data":{"__proto__":{"x":1}}}')).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('rejects junk', () => {
    expect(parseClientMessage('nope')).toBeNull();
    expect(parseClientMessage('{"t":"HACK","score":999999}')).toBeNull();
    expect(parseClientMessage('{"t":"INPUT","mx":"1","my":0}')).toBeNull();
    expect(parseClientMessage('{"t":"INPUT","mx":null,"my":0}')).toBeNull();
  });
  it('clamps input axes and ignores authoritative fields', () => {
    const m = parseClientMessage('{"t":"INPUT","seq":1,"mx":50,"my":-9,"a1":true,"x":5000,"score":999999}');
    expect(m).toEqual({ t: 'INPUT', seq: 1, mx: 1, my: -1, a1: true, a2: false });
  });
  it('validates join', () => {
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"  <b>Bob</b>  ","code":"7k4p"}')).toEqual({
      t: 'JOIN_ROOM',
      v: 1,
      name: 'bBob/b',
      code: '7K4P',
    });
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"x","code":"0000"}')).toBeNull();
  });
});

describe('host management messages', () => {
  const p = (o: unknown) => parseClientMessage(JSON.stringify(o));
  it('parses role swaps', () => {
    expect(p({ t: 'LEAVE_SEAT' })).toEqual({ t: 'LEAVE_SEAT' });
    expect(p({ t: 'SET_ROLE', id: 'x', spectator: true })).toEqual({ t: 'SET_ROLE', id: 'x', spectator: true });
    expect(p({ t: 'SET_ROLE', id: 'x' })).toBeNull();
    expect(p({ t: 'SET_ROLE', id: '', spectator: false })).toBeNull();
  });
  it('parses ids', () => {
    expect(p({ t: 'KICK', id: 'a1b2c3' })).toEqual({ t: 'KICK', id: 'a1b2c3' });
    expect(p({ t: 'MAKE_HOST', id: 'x' })).toEqual({ t: 'MAKE_HOST', id: 'x' });
    expect(p({ t: 'RESET_NAME', id: 'x' })).toEqual({ t: 'RESET_NAME', id: 'x' });
    for (const t of ['KICK', 'MAKE_HOST', 'RESET_NAME']) {
      expect(p({ t })).toBeNull();
      expect(p({ t, id: '' })).toBeNull();
      expect(p({ t, id: 5 })).toBeNull();
      expect(p({ t, id: 'x'.repeat(40) })).toBeNull();
    }
  });
  it('validates room settings', () => {
    expect(p({ t: 'ROOM_SETTINGS', locked: true })).toEqual({ t: 'ROOM_SETTINGS', locked: true });
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: 4, locked: false })).toEqual({ t: 'ROOM_SETTINGS', maxPlayers: 4, locked: false });
    expect(p({ t: 'ROOM_SETTINGS' })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', lateJoin: true, catchUp: 50 })).toEqual({ t: 'ROOM_SETTINGS', lateJoin: true, catchUp: 50 });
    expect(p({ t: 'ROOM_SETTINGS', lateJoin: 1 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', catchUp: 101 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', catchUp: -1 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', locked: 'yes' })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: 2.5 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: 0 })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', maxPlayers: 999 })).toBeNull();
  });
  it('validates a new selection', () => {
    expect(p({ t: 'SET_SELECTION', game: 'ballistix', variant: 'cloud-orbs' })).toMatchObject({
      t: 'SET_SELECTION',
      selection: { game: 'ballistix', variant: 'cloud-orbs' },
    });
    expect(p({ t: 'SET_SELECTION', game: 'nope', variant: 'x' })).toBeNull();
  });
});

describe('playlists on the wire', () => {
  const playlist = [{ game: 'crazy-logs' }, { game: 'ballistix', variant: 'smashball', options: { lives: 4 } }];
  it('JOIN_ROOM and SET_SELECTION carry a playlist', () => {
    const join = parseClientMessage(JSON.stringify({ t: 'JOIN_ROOM', v: 1, name: 'a', playlist }));
    expect(join).toMatchObject({ selection: { game: 'custom', playlist: [{ game: 'crazy-logs' }, { variant: 'smashball' }] } });
    const set = parseClientMessage(JSON.stringify({ t: 'SET_SELECTION', playlist }));
    expect(set).toMatchObject({ t: 'SET_SELECTION', selection: { game: 'custom' } });
  });
  it('an invalid playlist rejects the whole message', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'JOIN_ROOM', v: 1, name: 'a', playlist: [{ game: 'nope' }] }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'SET_SELECTION', playlist: [] }))).toBeNull();
  });
});

describe('profile key on join', () => {
  const key = 'ab'.repeat(16);
  it('is kept when well formed and dropped otherwise', () => {
    const ok = parseClientMessage(JSON.stringify({ t: 'JOIN_ROOM', v: 1, name: 'a', code: '7K4P', profileKey: key }));
    expect(ok).toMatchObject({ profileKey: key });
    for (const bad of ['short', 'Z'.repeat(32), 5, '']) {
      const m = parseClientMessage(JSON.stringify({ t: 'JOIN_ROOM', v: 1, name: 'a', code: '7K4P', profileKey: bad }));
      expect(m).not.toBeNull();
      expect(m).not.toHaveProperty('profileKey');
    }
  });
});

describe('room creation selection', () => {
  it('accepts a valid game + variant only when creating', () => {
    const m = parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","game":"ballistix","variant":"cloud-orbs"}');
    expect(m).toMatchObject({ t: 'JOIN_ROOM', selection: { game: 'ballistix', variant: 'cloud-orbs' } });
    const j = parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":"7K4P","game":"ballistix"}');
    expect(j).toMatchObject({ code: '7K4P', selection: undefined });
  });
  it('rejects unknown game or variant', () => {
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","game":"x"}')).toBeNull();
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","game":"ballistix","variant":"x"}')).toBeNull();
  });
});

describe('sanitizeName invisible characters', () => {
  it('strips bidi overrides and falls back for invisible-only names', () => {
    expect(sanitizeName('\u202eBob\u200b')).toBe('Bob');
    expect(sanitizeName('\u200b\u202e')).toBe('Player');
  });
});

describe('helpers', () => {
  it('sanitizeName', () => {
    expect(sanitizeName('a'.repeat(40))).toHaveLength(16);
    expect(sanitizeName('   ')).toBe('Player');
    expect(sanitizeName(42)).toBe('Player');
  });
  it('room codes are 4 valid chars', () => {
    const code = generateRoomCodeForTest();
    expect(normalizeRoomCode(code)).toBe(code);
  });
});

describe('room options on JOIN_ROOM', () => {
  it('carries validated options only when creating', () => {
    const m = parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","game":"ballistix","variant":"smashball","options":{"lives":8,"smashGain":2.2}}');
    expect(m).toMatchObject({ selection: { options: { lives: 8, smashGain: 2.2 } } });
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","game":"ballistix","variant":"smashball","options":{"x":1}}')).toBeNull();
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":"7K4P","options":{"x":1}}')).toMatchObject({ selection: undefined });
  });
});

describe('spectate / join as player', () => {
  it('spectate needs a room code', () => {
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","spectate":true}')).toBeNull();
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":"7K4P","spectate":true}')).toMatchObject({
      code: '7K4P',
      spectate: true,
    });
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":"7K4P"}')).not.toHaveProperty('spectate');
  });
  it('parses JOIN_AS_PLAYER', () => {
    expect(parseClientMessage('{"t":"JOIN_AS_PLAYER"}')).toEqual({ t: 'JOIN_AS_PLAYER' });
  });
});

describe('vote messages', () => {
  it('parses valid votes and rejects junk', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'VOTE_START', kind: 'round' }))).toEqual({ t: 'VOTE_START', kind: 'round' });
    expect(parseClientMessage(JSON.stringify({ t: 'VOTE_START', kind: 'match' }))).toEqual({ t: 'VOTE_START', kind: 'match' });
    expect(parseClientMessage(JSON.stringify({ t: 'VOTE_START', kind: 'lobby' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'VOTE_START' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'VOTE', yes: true }))).toEqual({ t: 'VOTE', yes: true });
    expect(parseClientMessage(JSON.stringify({ t: 'VOTE', yes: 'yes' }))).toBeNull();
  });
});

describe('rejectedJoinError', () => {
  it('reports invalid JOIN_ROOM frames', () => {
    expect(rejectedJoinError('{"t":"JOIN_ROOM","v":1,"code":"0000"}')?.code).toBe('ROOM_NOT_FOUND');
    expect(rejectedJoinError('{"t":"JOIN_ROOM","v":1,"spectate":true}')?.code).toBe('BAD_STATE');
  });
  it('stays silent for garbage and other frames', () => {
    expect(rejectedJoinError('nope')).toBeNull();
    expect(rejectedJoinError('{"t":"INPUT","mx":"1"}')).toBeNull();
  });
});

describe('parseClientMessage edge cases', () => {
  it('rejects non-object, array, and wrong-typed frames', () => {
    for (const raw of ['', 'null', '[]', '42', '"INPUT"', '{}', '{"t":1}', '{"t":null}', '{"t":["PING"]}', '{"t":"ping","ts":1}']) {
      expect(parseClientMessage(raw)).toBeNull();
    }
  });
  it('rejects non-finite numbers (JSON overflow, NaN-like)', () => {
    expect(parseClientMessage('{"t":"INPUT","mx":1e999,"my":0}')).toBeNull();
    expect(parseClientMessage('{"t":"INPUT","mx":0,"my":-1e999}')).toBeNull();
    expect(parseClientMessage('{"t":"PING","ts":1e999}')).toBeNull();
    expect(parseClientMessage('{"t":"PING","ts":"1"}')).toBeNull();
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":"1","name":"a","game":"ballistix"}')).toBeNull();
  });
  it('INPUT: non-numeric seq becomes 0, flags must be exactly true, seq truncated to int32', () => {
    expect(parseClientMessage('{"t":"INPUT","seq":"x","mx":0,"my":0,"a1":1,"a2":"true"}')).toEqual({
      t: 'INPUT',
      seq: 0,
      mx: 0,
      my: 0,
      a1: false,
      a2: false,
    });
    expect(parseClientMessage('{"t":"INPUT","seq":4294967301,"mx":0.5,"my":0}')).toMatchObject({ seq: 5, mx: 0.5 });
    expect(parseClientMessage('{"t":"INPUT","seq":3.9,"mx":0,"my":0}')).toMatchObject({ seq: 3 });
  });
  it('READY requires a boolean; extra fields on simple messages are dropped', () => {
    expect(parseClientMessage('{"t":"READY","ready":1}')).toBeNull();
    expect(parseClientMessage('{"t":"READY"}')).toBeNull();
    expect(parseClientMessage('{"t":"START_GAME","host":true}')).toEqual({ t: 'START_GAME' });
  });
  it('JOIN_ROOM: empty code means create; room code is trimmed and uppercased', () => {
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":""}')).toMatchObject({ code: undefined });
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":" 7k4p "}')).toMatchObject({ code: '7K4P' });
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":12}')).toBeNull();
    expect(parseClientMessage('{"t":"JOIN_ROOM","v":1,"name":"a","code":"7K4PX"}')).toBeNull();
  });
  it('JOIN_ROOM: spectate must be literally true; missing name falls back', () => {
    const m = parseClientMessage('{"t":"JOIN_ROOM","v":1,"code":"7K4P","spectate":"true"}');
    expect(m).toMatchObject({ name: 'Player' });
    expect(m).not.toHaveProperty('spectate');
  });
});

describe('sanitizeName edge cases', () => {
  it('strips control characters and angle brackets', () => {
    expect(sanitizeName('a\u0000b\nc\u007fd\te')).toBe('abcde');
    expect(sanitizeName('<b>hi</b>')).toBe('bhi/b');
  });
  it('falls back when nothing printable is left', () => {
    expect(sanitizeName('<>')).toBe('Player');
    expect(sanitizeName(' \u0007 \u0000 ')).toBe('Player');
    expect(sanitizeName('')).toBe('Player');
    expect(sanitizeName(null)).toBe('Player');
    expect(sanitizeName({ toString: () => 'x' })).toBe('Player');
  });
  it('trims, keeps inner spaces and unicode, and never exceeds the limit', () => {
    expect(sanitizeName('  Ana María  ')).toBe('Ana María');
    expect(sanitizeName('x'.repeat(16))).toHaveLength(16);
    expect(sanitizeName('x'.repeat(17))).toHaveLength(16);
    expect(sanitizeName('  ' + 'y'.repeat(30)).length).toBeLessThanOrEqual(16);
  });
});

describe('normalizeRoomCode edge cases', () => {
  it('rejects non-strings, wrong length, and characters outside the alphabet', () => {
    expect(normalizeRoomCode(undefined)).toBeNull();
    expect(normalizeRoomCode(1234)).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('0O1I')).toBeNull();
    expect(normalizeRoomCode(' 7k4p\n')).toBe('7K4P');
  });
});

describe('sanitizeName invisible characters', () => {
  it('strips zero-width, bidi and format chars', () => {
    expect(sanitizeName('a\u200bb\u202ec\u2066d\ufeffe\u00adf\u2060g')).toBe('abcdefg');
  });
  it('falls back to Player when only invisible chars remain', () => {
    expect(sanitizeName('\u200b\u202e\ufeff')).toBe('Player');
  });
  it('NFC-normalizes', () => {
    expect(sanitizeName('e\u0301')).toBe('\u00e9');
  });
  it('trims after truncating', () => {
    const out = sanitizeName('a'.repeat(15) + ' b');
    expect(out).toBe('a'.repeat(15));
  });

  it('accepts spectateIfBusy only when joining an existing room as a player', () => {
    const base = '{"t":"JOIN_ROOM","v":1,"name":"a"';
    expect(parseClientMessage(`${base},"code":"7K4P","spectateIfBusy":true}`)).toMatchObject({ code: '7K4P', spectateIfBusy: true });
    expect(parseClientMessage(`${base},"spectateIfBusy":true}`)).not.toHaveProperty('spectateIfBusy');
    expect(parseClientMessage(`${base},"code":"7K4P","spectate":true,"spectateIfBusy":true}`)).not.toHaveProperty('spectateIfBusy');
    expect(parseClientMessage(`${base},"code":"7K4P","spectateIfBusy":"yes"}`)).not.toHaveProperty('spectateIfBusy');
  });

  it('validates the optional resume token', () => {
    const tok = 'ab'.repeat(16);
    const base = '{"t":"JOIN_ROOM","v":1,"name":"a","code":"7K4P"';
    expect(parseClientMessage(`${base},"resume":"${tok}"}`)).toMatchObject({ resume: tok, code: '7K4P' });
    expect(parseClientMessage(`${base}}`)).not.toHaveProperty('resume');
    for (const bad of ['"zz' + 'a'.repeat(30) + '"', '"abc"', `"${'a'.repeat(65)}"`, `"${tok.toUpperCase()}"`, '5', 'null']) {
      expect(parseClientMessage(`${base},"resume":${bad}}`)).toBeNull();
    }
    // token without a room code is invalid
    expect(parseClientMessage(`{"t":"JOIN_ROOM","v":1,"name":"a","resume":"${tok}"}`)).toBeNull();
  });

  it('validates room passwords', () => {
    const p = (o: unknown) => parseClientMessage(JSON.stringify(o));
    const join = { t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A', code: 'ABCD' };
    expect(p({ ...join, password: ' sesame ' })).toMatchObject({ password: 'sesame' });
    // supplied-but-unusable passwords are kept as '' (so the server says WRONG_PASSWORD, not REQUIRED)
    expect(p({ ...join, password: 5 })).toMatchObject({ password: '' });
    expect(p({ ...join, password: '   ' })).toMatchObject({ password: '' });
    expect(p({ ...join, password: 'x'.repeat(40) })).toMatchObject({ password: '' });
    expect(p(join)).not.toHaveProperty('password');
    expect(p({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'A', password: 'x'.repeat(40) })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', password: 'pw' })).toEqual({ t: 'ROOM_SETTINGS', password: 'pw' });
    expect(p({ t: 'ROOM_SETTINGS', password: null })).toEqual({ t: 'ROOM_SETTINGS', password: null });
    expect(p({ t: 'ROOM_SETTINGS', password: 'x'.repeat(40) })).toBeNull();
  });

  it('validates plugin messages', () => {
    const p = (o: unknown) => parseClientMessage(JSON.stringify(o));
    const join = { t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Bot', code: 'ABCD' };
    expect(p({ ...join, plugin: { id: 'bots', token: 's3cret', data: { level: 'hard' } } })).toMatchObject({ plugin: { id: 'bots', token: 's3cret', data: { level: 'hard' } } });
    expect(p({ ...join, plugin: { id: 'bots' } })).toMatchObject({ plugin: { id: 'bots', data: {} } });
    expect(p({ ...join, plugin: { id: 'Bad Id' } })).toBeNull();
    expect(p({ ...join, plugin: { id: 'bots', token: '' } })).toBeNull();
    expect(p({ ...join, plugin: { id: 'bots', data: [1] } })).toBeNull();
    expect(p({ ...join, plugin: 'bots' })).toBeNull();
    expect(p({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Bot', plugin: { id: 'bots' } })).toBeNull();
    expect(p(join)).not.toHaveProperty('plugin');
    expect(p({ t: 'PLUGIN_ACTION', plugin: 'bots', data: { a: 'fill', on: true } })).toEqual({ t: 'PLUGIN_ACTION', plugin: 'bots', data: { a: 'fill', on: true } });
    expect(p({ t: 'PLUGIN_ACTION', plugin: 'Bots', data: {} })).toBeNull();
    expect(p({ t: 'PLUGIN_ACTION', plugin: 'bots', data: 'x' })).toBeNull();
    expect(p({ t: 'PLUGIN_ACTION', plugin: 'bots', data: { big: 'x'.repeat(5000) } })).toBeNull();
    expect(p({ t: 'ROOM_SETTINGS', botFill: true })).toBeNull();
  });
});
