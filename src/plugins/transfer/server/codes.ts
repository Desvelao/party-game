import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
export const TRANSFER_CODE_LENGTH = 8;
export const TRANSFER_TTL_MS = 5 * 60_000;
const MAX_LIVE = 500;

/** Uppercase and drop separators, so "abcd-efgh" and "ABCDEFGH" are the same code. */
export function normalizeTransferCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Short-lived, single-use codes that hand a profile key to another device. In memory only:
 * a restart just invalidates the pending codes.
 */
export class TransferCodes {
  private readonly codes = new Map<string, { key: string; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A fresh code for `key` (replaces any live one for that key); null when the store is full. */
  issue(key: string): string | null {
    const t = this.now();
    for (const [code, v] of this.codes) {
      if (v.expires <= t || v.key === key) this.codes.delete(code);
    }
    if (this.codes.size >= MAX_LIVE) return null;
    let code: string;
    do {
      code = '';
      for (let i = 0; i < TRANSFER_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    } while (this.codes.has(code));
    this.codes.set(code, { key, expires: t + TRANSFER_TTL_MS });
    return code;
  }

  /** The key behind a code, which is then burnt. */
  redeem(raw: string): string | null {
    const code = normalizeTransferCode(raw);
    const v = this.codes.get(code);
    if (!v) return null;
    this.codes.delete(code);
    return v.expires > this.now() ? v.key : null;
  }
}
