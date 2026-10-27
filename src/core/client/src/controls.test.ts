import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTROLS, defaultControls } from '../../shared';

function memStore(initial: Record<string, string> = {}, broken = false) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k: string) => {
      if (broken) throw new Error('blocked');
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error('blocked');
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      if (broken) throw new Error('blocked');
      m.delete(k);
    },
  };
}

const CUSTOM = { ...defaultControls(), action: ['KeyF'], action2: ['KeyG'] };
let local: ReturnType<typeof memStore>;
let session: ReturnType<typeof memStore>;
let fetchMock: ReturnType<typeof vi.fn>;

async function load() {
  vi.resetModules();
  return import('./controls');
}

beforeEach(() => {
  local = memStore();
  session = memStore();
  fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return { ok: true, json: async () => ({ profile: { name: 'N', controls: body.controls } }) } as Response;
  });
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(1) });
});
afterEach(() => vi.unstubAllGlobals());

describe('controls storage', () => {
  it('defaults when nothing is stored', async () => {
    const c = await load();
    expect(c.loadControls()).toEqual(DEFAULT_CONTROLS);
  });

  it('a guest keeps controls in sessionStorage only and never calls the server', async () => {
    session.m.set('party-game:guest', '1');
    const c = await load();
    const saved = await c.saveControls(CUSTOM, true);
    expect(saved.action).toEqual(['KeyF']);
    expect(session.m.has(c.CONTROLS_KEY)).toBe(true);
    expect(local.m.has(c.CONTROLS_KEY)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // a fresh page of the same tab reads them back
    const again = await load();
    expect(again.loadControls(true).action).toEqual(['KeyF']);
  });

  it('a registered player (no saved profile yet) saves to localStorage and does not create a record', async () => {
    const c = await load();
    await c.saveControls(CUSTOM, false);
    expect(local.m.has(c.CONTROLS_KEY)).toBe(true);
    expect(session.m.has(c.CONTROLS_KEY)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with a saved profile the controls are also sent to it, and its answer is kept', async () => {
    local.m.set('party-game:profile', JSON.stringify({ name: 'N' }));
    local.m.set('party-game:profile-key', 'a'.repeat(32));
    const c = await load();
    const saved = await c.saveControls(CUSTOM, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/profile');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ controls: CUSTOM });
    expect(saved.action).toEqual(['KeyF']);
  });

  it('the profile cache supplies the controls when local storage has none (another device)', async () => {
    local.m.set('party-game:profile', JSON.stringify({ name: 'N', controls: CUSTOM }));
    const c = await load();
    expect(c.loadControls(false).action2).toEqual(['KeyG']);
  });

  it('adoptProfileControls copies the profile keys into the browser', async () => {
    const c = await load();
    c.adoptProfileControls({ controls: CUSTOM });
    expect(c.loadControls(false).action).toEqual(['KeyF']);
    expect(JSON.parse(local.m.get(c.CONTROLS_KEY)!).action).toEqual(['KeyF']);
  });

  it('reset restores the defaults and clears the stored copy', async () => {
    const c = await load();
    await c.saveControls(CUSTOM, false);
    const back = await c.resetControls(false);
    expect(back).toEqual(DEFAULT_CONTROLS);
    expect(local.m.has(c.CONTROLS_KEY)).toBe(false);
  });

  it('survives blocked storage: defaults to start with, then the page keeps what was set', async () => {
    vi.stubGlobal('localStorage', memStore({}, true));
    vi.stubGlobal('sessionStorage', memStore({}, true));
    const c = await load();
    expect(c.loadControls(false)).toEqual(DEFAULT_CONTROLS);
    await c.saveControls(CUSTOM, false);
    expect(c.loadControls(false).action).toEqual(['KeyF']);
  });

  it('garbage in storage falls back to the defaults', async () => {
    local.m.set('party-game:controls', '{not json');
    const c = await load();
    expect(c.loadControls(false)).toEqual(DEFAULT_CONTROLS);
    local.m.set('party-game:controls', JSON.stringify({ up: ['ControlLeft'], action: 5 }));
    expect((await load()).loadControls(false)).toEqual(DEFAULT_CONTROLS);
  });

  it('notifies listeners when the controls change', async () => {
    const c = await load();
    const fn = vi.fn();
    c.onControlsChange(fn);
    await c.saveControls(CUSTOM, false);
    expect(fn).toHaveBeenCalled();
  });
});
