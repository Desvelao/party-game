import { describe, expect, it } from 'vitest';
import { qrMatrix } from './qr';

describe('qrMatrix', () => {
  it('sizes by version', () => {
    expect(qrMatrix('hi')!.length).toBe(21);
    expect(qrMatrix('x'.repeat(100))!.length).toBe(37); // version 5
  });
  it('rejects text that does not fit', () => {
    expect(qrMatrix('x'.repeat(400))).toBeNull();
  });
  it('has finder patterns', () => {
    const m = qrMatrix('hello')!;
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[3][3]).toBe(true);
    expect(m[1][1]).toBe(false);
  });
});
