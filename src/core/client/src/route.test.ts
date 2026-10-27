import { describe, expect, it } from 'vitest';
import { parseLocation, roomPath } from './route';

describe('parseLocation', () => {
  it('maps paths to views', () => {
    expect(parseLocation('/', '')).toEqual({ view: 'menu' });
    expect(parseLocation('/profile', '')).toEqual({ view: 'profile' });
    expect(parseLocation('/room/abcd', '')).toEqual({ view: 'room', code: 'ABCD', spectate: false });
    expect(parseLocation('/room/ABCD', '?spectate=1')).toEqual({ view: 'room', code: 'ABCD', spectate: true });
  });

  it('still understands the old query links', () => {
    expect(parseLocation('/', '?view=profile')).toEqual({ view: 'profile' });
    expect(parseLocation('/', '?room=ABCD&spectate=1')).toEqual({ view: 'room', code: 'ABCD', spectate: true });
  });

  it('falls back to the menu for an invalid code', () => {
    expect(parseLocation('/room/x', '')).toEqual({ view: 'menu' });
  });

  it('builds room paths', () => {
    expect(roomPath('ABCD')).toBe('/room/ABCD');
    expect(roomPath('ABCD', true)).toBe('/room/ABCD?spectate=1');
    expect(roomPath('ABCD', false, 'se sa&me')).toBe('/room/ABCD?password=se+sa%26me');
    expect(roomPath('ABCD', true, 'pw')).toBe('/room/ABCD?spectate=1&password=pw');
  });

  it('reads the password query parameter', () => {
    expect(parseLocation('/room/ABCD', '?password=pw')).toEqual({ view: 'room', code: 'ABCD', spectate: false, password: 'pw' });
    // what roomPath builds must parse back to the same values
    const [path, query] = roomPath('ABCD', true, 'a b&c').split('?');
    expect(parseLocation(path!, '?' + query)).toEqual({ view: 'room', code: 'ABCD', spectate: true, password: 'a b&c' });
  });
});
