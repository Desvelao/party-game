import { describe, expect, it } from 'vitest';
import { ConsoleManager } from './console';

describe('ConsoleManager', () => {
  it('makes a 6-digit PIN and a fresh one on request', () => {
    const m = new ConsoleManager();
    expect(m.pin).toMatch(/^\d{6}$/);
    const seen = new Set([m.pin]);
    for (let i = 0; i < 20; i++) seen.add(m.newPin());
    expect(seen.size).toBeGreaterThan(1);
  });
  it('pairs with the right PIN only', () => {
    const m = new ConsoleManager();
    const bad = m.pair('1.1.1.1', m.pin === '111111' ? '222222' : '111111');
    expect(bad).toMatchObject({ ok: false, status: 401 });
    expect(m.pair('1.1.1.1', 42)).toMatchObject({ ok: false });
    const ok = m.pair('1.1.1.1', ` ${m.pin} `);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(m.validToken(ok.token)).toBe(true);
    expect(m.validToken('nope')).toBe(false);
    expect(m.validToken('')).toBe(false);
  });
  it('blocks an IP after too many wrong PINs, until the window passes', () => {
    let now = 0;
    const m = new ConsoleManager(() => now);
    for (let i = 0; i < 10; i++) m.pair('9.9.9.9', 'x');
    expect(m.pair('9.9.9.9', m.pin)).toMatchObject({ ok: false, status: 429 });
    expect(m.pair('8.8.8.8', m.pin).ok).toBe(true); // another address is unaffected
    now = 61_000;
    expect(m.pair('9.9.9.9', m.pin).ok).toBe(true);
  });
  it('keeps the lockout when many addresses fail, and replaces the PIN after 30 wrong guesses', () => {
    const m = new ConsoleManager(() => 0);
    for (let i = 0; i < 10; i++) m.pair('9.9.9.9', 'x');
    const first = m.pin;
    for (let i = 0; i < 15; i++) m.pair(`2001:db8::${i}`, 'x');
    expect(m.pair('9.9.9.9', 'x')).toMatchObject({ status: 429 });
    expect(m.pin).toBe(first); // 25 wrong so far
    for (let i = 0; i < 5; i++) m.pair(`2001:db8::1${i}`, 'x');
    expect(m.pin).not.toBe(first); // (a new random PIN equals the old one only 1 time in a million)
  });
  it('unpairs every phone and keeps a bounded list', () => {
    const m = new ConsoleManager();
    const first = m.pair('a', m.pin);
    for (let i = 0; i < 20; i++) m.pair('a', m.pin);
    expect(m.paired).toBe(16);
    if (first.ok) expect(m.validToken(first.token)).toBe(false); // the oldest was dropped
    expect(m.unpairAll()).toBe(16);
    expect(m.paired).toBe(0);
  });
});
