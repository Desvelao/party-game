import { describe, expect, it } from 'vitest';
import { PROFILE_KEY, adoptProfileKey, persistLang, cachedProfile, fetchProfile, loadProfileKey, saveProfile, winRate } from './profile';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};
const KEY = 'ab'.repeat(16);

describe('profile key', () => {
  it('is created once and then reused', () => {
    const st = memory();
    const a = loadProfileKey(st, () => KEY);
    expect(a).toBe(KEY);
    expect(st.m.get(PROFILE_KEY)).toBe(KEY);
    expect(loadProfileKey(st, () => 'ff'.repeat(16))).toBe(KEY);
  });
  it('replaces a malformed stored key', () => {
    const st = memory();
    st.setItem(PROFILE_KEY, 'garbage');
    expect(loadProfileKey(st, () => KEY)).toBe(KEY);
  });
  it('still returns a key when storage is blocked', () => {
    expect(loadProfileKey(broken, () => KEY)).toBe(KEY);
  });
  it('adopts a valid recovery code only', () => {
    const st = memory();
    expect(adoptProfileKey('nope', st)).toBe(false);
    expect(adoptProfileKey(`  ${KEY.toUpperCase()} `, st)).toBe(true);
    expect(st.m.get(PROFILE_KEY)).toBe(KEY);
  });
});

describe('profile api helpers', () => {
  const rec = { name: 'A', color: 1, look: {}, createdAt: 1, lastSeen: 1, stats: { matches: 4, wins: 1 } };
  const ok = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body }) as Response;

  it('fetches, caches and sends the bearer key', async () => {
    const st = memory();
    let seen: RequestInit | undefined;
    const f = async (_: string, init?: RequestInit) => {
      seen = init;
      return ok({ profile: rec })() as Promise<Response>;
    };
    expect(await fetchProfile(KEY, f, st)).toEqual(rec);
    expect((seen?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(cachedProfile(st)).toEqual(rec);
  });
  it('throws on server errors', async () => {
    const f = async () => ({ ok: false, status: 500 }) as Response;
    await expect(fetchProfile(KEY, f, memory())).rejects.toThrow();
    await expect(saveProfile(KEY, { name: 'x' }, f, memory())).rejects.toThrow();
  });
  it('computes the win rate', () => {
    expect(winRate({ matches: 4, wins: 1 } as any)).toBe(25);
    expect(winRate({ matches: 0, wins: 0 } as any)).toBe(0);
  });
});

describe('persistLang', () => {
  const cached = { name: 'A', color: 0, look: {}, createdAt: 1, lastSeen: 1, stats: {} };
  const spy = () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ profile: { ...cached, lang: 'es' } }) } as Response;
    };
    return { calls, f };
  };

  it('does nothing without a saved profile', () => {
    const st = memory();
    st.setItem(PROFILE_KEY, KEY);
    const { calls, f } = spy();
    persistLang('es', f, st);
    expect(calls).toHaveLength(0);
  });

  it('sends the language for a saved profile, and skips when unchanged', async () => {
    const st = memory();
    st.setItem(PROFILE_KEY, KEY);
    st.setItem('party-game:profile', JSON.stringify(cached));
    const { calls, f } = spy();
    persistLang('es', f, st);
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ lang: 'es' });
    await new Promise((r) => setTimeout(r, 0));
    persistLang('es', f, st); // cache now holds lang: 'es'
    expect(calls).toHaveLength(1);
  });
});

describe('recovery input', () => {
  const key = 'ab'.repeat(16);
  const memory = () => {
    const store = new Map<string, string>();
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  };
  it('parses keys and recovery links, and leaves the rest to plugins', async () => {
    const { parseRecoveryInput, recoveryLink } = await import('./profile');
    expect(parseRecoveryInput(` ${key.toUpperCase()} `)).toEqual({ key });
    expect(parseRecoveryInput(recoveryLink(key, 'https://x.test'))).toEqual({ key });
    expect(parseRecoveryInput('abcd-2345')).toBeNull();
    expect(parseRecoveryInput('nope')).toBeNull();
  });
  it('adopts a key without asking a plugin', async () => {
    const { applyRecoveryInput } = await import('./profile');
    const never = async () => {
      throw new Error('asked');
    };
    expect(await applyRecoveryInput(key, memory() as never, never)).toBe(true);
  });
  it('asks the plugins about anything else, and takes only a valid key back', async () => {
    const { applyRecoveryInput } = await import('./profile');
    expect(await applyRecoveryInput('ABCD-2345', memory() as never, async () => key)).toBe(true);
    expect(await applyRecoveryInput('ABCD-2345', memory() as never, async () => null)).toBe(false);
    expect(await applyRecoveryInput('ABCD-2345', memory() as never, async () => 'short')).toBe(false);
    expect(await applyRecoveryInput('ABCD-2345', memory() as never, async () => Promise.reject(new Error('down')))).toBe(false);
    expect(await applyRecoveryInput('ABCD-2345', memory() as never)).toBe(false); // no plugin installed
  });
});
