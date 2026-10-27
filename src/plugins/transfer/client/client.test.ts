import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin, { codeFrom } from './index';

const KEY = 'ab'.repeat(16);

afterEach(() => vi.unstubAllGlobals());

describe('codeFrom', () => {
  it('reads codes, links and ignores the rest', () => {
    expect(codeFrom('abcd-2345')).toBe('ABCD2345');
    expect(codeFrom(' ABCD2345 ')).toBe('ABCD2345');
    expect(codeFrom('https://x.test/#transfer=ABCD2345')).toBe('ABCD2345');
    expect(codeFrom(KEY)).toBeNull();
    expect(codeFrom('nope')).toBeNull();
  });
});

describe('recoveryInput', () => {
  it('trades a code for the key, and refuses unknown codes and other input', async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes('ABCD2345') ? new Response(JSON.stringify({ key: KEY })) : new Response('{}', { status: 404 })));
    vi.stubGlobal('fetch', fetchFn);
    expect(plugin.recoveryInput!.hash).toBe('transfer');
    expect(await plugin.recoveryInput!.resolve('abcd-2345')).toBe(KEY);
    expect(fetchFn).toHaveBeenCalledWith('/api/transfer?code=ABCD2345', { cache: 'no-store' });
    expect(await plugin.recoveryInput!.resolve('ZZZZ2222')).toBeNull();
    fetchFn.mockClear();
    expect(await plugin.recoveryInput!.resolve(KEY)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not accept a malformed key from the server', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ key: 'short' })));
    expect(await plugin.recoveryInput!.resolve('ABCD2345')).toBeNull();
  });
});
