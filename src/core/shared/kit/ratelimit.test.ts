import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter, apiLimiter } from './ratelimit';

describe('FixedWindowLimiter', () => {
  it('allows `limit` hits per window then resets', () => {
    const l = new FixedWindowLimiter(2, 1000, 10);
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('a', 1)).toBe(true);
    expect(l.allow('a', 2)).toBe(false);
    expect(l.allow('b', 2)).toBe(true);
    expect(l.allow('a', 1000)).toBe(true);
  });

  it('evicts expired entries without wiping live counters', () => {
    const l = new FixedWindowLimiter(1, 1000, 3);
    l.allow('old1', 0);
    l.allow('old2', 0);
    l.allow('live', 500);
    expect(l.allow('live', 600)).toBe(false);
    l.allow('new', 1100); // size 4 > 3: old1/old2 expired and dropped
    expect(l.size).toBe(2);
    expect(l.allow('live', 1200)).toBe(false);
  });

  it('evicts oldest-first when nothing has expired and stays bounded', () => {
    const l = new FixedWindowLimiter(1, 10_000, 3);
    for (let i = 0; i < 100; i++) l.allow(`ip${i}`, i);
    expect(l.size).toBe(3);
    expect(l.allow('ip99', 200)).toBe(false);
    expect(l.allow('ip0', 200)).toBe(true);
  });

  it('apiLimiter allows 60 calls a minute per address', () => {
    const l = apiLimiter();
    for (let i = 0; i < 60; i++) expect(l.allow('a', i)).toBe(true);
    expect(l.allow('a', 61)).toBe(false);
    expect(l.allow('b', 61)).toBe(true);
    expect(l.allow('a', 60_000)).toBe(true);
  });

  it('clear forgets every counter', () => {
    const l = new FixedWindowLimiter(1, 1000, 10);
    l.allow('a', 0);
    expect(l.allow('a', 1)).toBe(false);
    l.clear();
    expect(l.size).toBe(0);
    expect(l.allow('a', 2)).toBe(true);
  });

  it('keeps serving new keys when the map is full of live windows (a flood cannot lock others out)', () => {
    const l = new FixedWindowLimiter(60, 60_000, 5000);
    for (let i = 0; i < 6000; i++) l.allow(`ip${i}`, i);
    expect(l.size).toBe(5000);
    expect(l.allow('late-comer', 6001)).toBe(true);
  });
});
