import { describe, expect, it } from 'vitest';
import { Ring } from './ring';

describe('Ring', () => {
  it('keeps everything below its capacity, oldest first', () => {
    const r = new Ring<number>(3);
    r.push(1);
    r.push(2);
    expect(r.length).toBe(2);
    expect(r.toArray()).toEqual([1, 2]);
  });

  it('drops the oldest entries beyond its capacity and keeps the order', () => {
    const r = new Ring<number>(3);
    for (let i = 1; i <= 8; i++) r.push(i);
    expect(r.length).toBe(3);
    expect(r.toArray()).toEqual([6, 7, 8]);
  });

  it('returns a copy', () => {
    const r = new Ring<number>(2);
    r.push(1);
    r.toArray().push(9);
    expect(r.toArray()).toEqual([1]);
  });
});
