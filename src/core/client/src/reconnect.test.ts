import { describe, expect, it } from 'vitest';
import {
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_MS,
  backoffMs,
  clearLastRoom,
  clearResume,
  loadLastRoom,
  saveLastRoom,
  loadResume,
  resumeErrorAction,
  saveResume,
  shouldGiveUp,
  startupResume,
} from './reconnect';

const info = { code: 'ABCD', token: 'ab'.repeat(16), name: 'Zed' };
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const broken = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('backoff', () => {
  it('is monotonic and bounded', () => {
    let prev = 0;
    for (let i = 0; i < 30; i++) {
      const d = backoffMs(i);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThanOrEqual(5000);
      prev = d;
    }
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(-3)).toBe(500);
  });
  it('total schedule fits the cap by giving up', () => {
    expect(shouldGiveUp(0, 0)).toBe(false);
    expect(shouldGiveUp(RECONNECT_MAX_ATTEMPTS, 0)).toBe(true);
    expect(shouldGiveUp(3, RECONNECT_MAX_MS)).toBe(true);
    expect(shouldGiveUp(3, 1000, 3)).toBe(true);
  });
});

describe('storage', () => {
  it('keeps a spectator entry without a token, and never resumes it as a player on startup', () => {
    const s = mem();
    const watcher = { code: 'ABCD', token: '', name: 'TV', spectate: true };
    saveResume(watcher, s);
    expect(loadResume(s)).toEqual(watcher);
    expect(startupResume(watcher, 'ABCD', false)).toBeNull();
    s.setItem('bonk.resume', JSON.stringify({ code: 'ABCD', token: '', name: 'x' }));
    expect(loadResume(s)).toBeNull(); // a player entry still needs its token
  });

  it('round-trips and clears', () => {
    const s = mem();
    saveResume(info, s);
    expect(loadResume(s)).toEqual(info);
    clearResume(s);
    expect(loadResume(s)).toBeNull();
  });
  it('remembers the last room until cleared', () => {
    const s = mem();
    saveLastRoom({ code: 'ABCD', name: 'Ann' }, s);
    expect(loadLastRoom(s)).toEqual({ code: 'ABCD', name: 'Ann' });
    clearLastRoom(s);
    expect(loadLastRoom(s)).toBeNull();
    expect(() => saveLastRoom({ code: 'ABCD', name: 'Ann' }, broken)).not.toThrow();
    expect(loadLastRoom(broken)).toBeNull();
  });
  it('ignores garbage', () => {
    const s = mem();
    s.setItem('bonk.resume', '{"code":1}');
    expect(loadResume(s)).toBeNull();
    s.setItem('bonk.resume', 'not json');
    expect(loadResume(s)).toBeNull();
  });
  it('never throws when storage is unavailable', () => {
    expect(() => saveResume(info, broken)).not.toThrow();
    expect(loadResume(broken)).toBeNull();
    expect(() => clearResume(broken)).not.toThrow();
    expect(() => saveResume(info, null)).not.toThrow();
    expect(loadResume(null)).toBeNull();
  });
});

describe('startupResume', () => {
  it('only for a matching room on a player link', () => {
    expect(startupResume(info, 'ABCD', false)).toEqual(info);
    expect(startupResume(info, 'WXYZ', false)).toBeNull();
    expect(startupResume(info, 'ABCD', true)).toBeNull();
    expect(startupResume(null, 'ABCD', false)).toBeNull();
    expect(startupResume(info, null, false)).toBeNull();
  });
});

describe('resumeErrorAction', () => {
  it('maps errors during a resume attempt', () => {
    expect(resumeErrorAction('ROOM_BUSY', false)).toBe('spectate');
    expect(resumeErrorAction('ROOM_FULL', false)).toBe('spectate');
    expect(resumeErrorAction('ROOM_NOT_FOUND', false)).toBe('menu');
    expect(resumeErrorAction('ROOM_CLOSED', false)).toBe('menu');
    expect(resumeErrorAction('ROOM_BUSY', true)).toBe('give-up');
  });
});
