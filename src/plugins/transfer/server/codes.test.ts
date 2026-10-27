import { describe, expect, it } from 'vitest';
import { TRANSFER_CODE_LENGTH, TRANSFER_TTL_MS, TransferCodes, normalizeTransferCode } from './codes';

const KEY = 'a'.repeat(32);

describe('TransferCodes', () => {
  it('issues a code that redeems once to the key', () => {
    const c = new TransferCodes();
    const code = c.issue(KEY)!;
    expect(code).toHaveLength(TRANSFER_CODE_LENGTH);
    expect(c.redeem(code)).toBe(KEY);
    expect(c.redeem(code)).toBeNull();
  });

  it('accepts lowercase and separators', () => {
    const c = new TransferCodes();
    const code = c.issue(KEY)!;
    expect(c.redeem(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase())).toBe(KEY);
  });

  it('expires', () => {
    let now = 0;
    const c = new TransferCodes(() => now);
    const code = c.issue(KEY)!;
    now = TRANSFER_TTL_MS + 1;
    expect(c.redeem(code)).toBeNull();
  });

  it('a new code replaces the previous one for the same key', () => {
    const c = new TransferCodes();
    const first = c.issue(KEY)!;
    const second = c.issue(KEY)!;
    expect(c.redeem(first)).toBeNull();
    expect(c.redeem(second)).toBe(KEY);
  });

  it('normalizes', () => {
    expect(normalizeTransferCode(' ab-cd ')).toBe('ABCD');
  });
});
