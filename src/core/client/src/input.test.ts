import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultControls } from '../../shared/controls';

type Handler = (e: any) => void;
let win: Record<string, Handler[]>;
let pads: any[];

function el() {
  const h: Record<string, Handler[]> = {};
  const knob = { style: { transform: '' } };
  const classes = new Set<string>();
  return {
    h,
    style: { translate: '' },
    classes,
    classList: { contains: (c: string) => classes.has(c) },
    addEventListener: (t: string, f: Handler) => (h[t] ??= []).push(f),
    querySelector: () => knob,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: () => {},
  };
}
const fire = (h: Record<string, Handler[]>, t: string, e: any = {}) => (h[t] ?? []).forEach((f) => f(e));

async function make(phase = 'playing', opts: any = {}) {
  const { InputController } = await import('./input');
  const joy = el();
  const dash = el();
  const mine = el();
  const cross = Object.assign(el(), { dataset: {} as Record<string, string> });
  const c = new InputController(joy as any, dash as any, () => phase, opts, mine as any, undefined, cross as any);
  return { c, joy, dash, mine, cross };
}
const key = (code: string) => ({ code, target: null, preventDefault: () => {} });

beforeEach(() => {
  win = {};
  pads = [];
  vi.stubGlobal('window', { addEventListener: (t: string, f: Handler) => (win[t] ??= []).push(f) });
  vi.stubGlobal('document', { addEventListener: () => {} });
  vi.stubGlobal('navigator', { getGamepads: () => pads });
});
afterEach(() => vi.unstubAllGlobals());

describe('InputController', () => {
  it('maps keys to movement and normalises diagonals', async () => {
    const { c } = await make();
    fire(win, 'keydown', key('KeyD'));
    fire(win, 'keydown', key('KeyS'));
    expect(c.sample()).toEqual({ mx: 0.71, my: 0.71, a1: false, a2: false });
    fire(win, 'keyup', key('KeyD'));
    fire(win, 'keyup', key('KeyS'));
    expect(c.sample()).toEqual({ mx: 0, my: 0, a1: false, a2: false });
  });

  it('latches a short dash tap exactly once', async () => {
    const { c } = await make();
    fire(win, 'keydown', key('Space'));
    fire(win, 'keyup', key('Space'));
    expect(c.sample().a1).toBe(true);
    expect(c.sample().a1).toBe(false);
  });

  it('dash button holds and latches', async () => {
    const { c, dash } = await make();
    fire(dash.h, 'pointerdown', { preventDefault: () => {} });
    expect(c.sample().a1).toBe(true);
    expect(c.sample().a1).toBe(true);
    fire(dash.h, 'pointerup');
    expect(c.sample().a1).toBe(false);
  });

  it('joystick overrides keyboard', async () => {
    const { c, joy } = await make();
    fire(win, 'keydown', key('KeyA'));
    fire(joy.h, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50 });
    const s = c.sample();
    expect(s.mx).toBe(1);
    expect(s.my).toBe(0);
    fire(joy.h, 'pointerup', { pointerId: 1 });
    expect(c.sample().mx).toBe(-1);
  });

  it('a floating stick re-centres under the thumb, stays on screen and snaps back on release', async () => {
    vi.stubGlobal('window', { innerWidth: 400, innerHeight: 800, addEventListener: (t: string, f: Handler) => (win[t] ??= []).push(f) });
    const { c, joy } = await make();
    joy.classes.add('floating');
    fire(joy.h, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 500 });
    expect(joy.style.translate).toBe('250px 450px'); // base centre (50,50) moved to the thumb
    fire(joy.h, 'pointerup', { pointerId: 1 });
    expect(joy.style.translate).toBe('');
    fire(joy.h, 'pointerdown', { pointerId: 2, clientX: 399, clientY: 799 });
    expect(joy.style.translate).toBe('300px 700px'); // clamped so the whole base is visible
  });

  it('gamepad overrides past the deadzone and presses dash', async () => {
    const { c } = await make();
    fire(win, 'keydown', key('KeyA'));
    pads = [null, { axes: [0.1, 0.1], buttons: [] }];
    expect(c.sample().mx).toBe(-1);
    pads = [{ axes: [0.5, 0], buttons: [{ pressed: true }] }];
    expect(c.sample()).toEqual({ mx: 0.5, my: 0, a1: true, a2: false });
  });

  it('blur clears keys and latch', async () => {
    const { c } = await make();
    fire(win, 'keydown', key('KeyD'));
    fire(win, 'keydown', key('Space'));
    fire(win, 'blur');
    expect(c.sample()).toEqual({ mx: 0, my: 0, a1: false, a2: false });
  });

  const btn = (...on: number[]) => Array.from({ length: 16 }, (_, i) => ({ pressed: on.includes(i) }));

  it('d-pad moves, normalises diagonals, and yields to the stick', async () => {
    const { c } = await make();
    pads = [{ axes: [0, 0], buttons: btn(15, 13) }];
    expect(c.sample()).toEqual({ mx: 0.71, my: 0.71, a1: false, a2: false });
    pads = [{ axes: [0, 0], buttons: btn(14) }];
    expect(c.sample().mx).toBe(-1);
    pads = [{ axes: [0.6, 0], buttons: btn(14) }];
    expect(c.sample().mx).toBe(0.6);
  });

  it('Start fires once per press and never without a pad', async () => {
    const onMenuButton = vi.fn();
    const { c } = await make('playing', { onMenuButton });
    c.sample();
    expect(onMenuButton).not.toHaveBeenCalled();
    pads = [{ axes: [0, 0], buttons: btn(9) }];
    c.sample();
    c.sample();
    expect(onMenuButton).toHaveBeenCalledTimes(1);
    pads = [{ axes: [0, 0], buttons: btn() }];
    c.sample();
    pads = [{ axes: [0, 0], buttons: btn(9) }];
    c.sample();
    expect(onMenuButton).toHaveBeenCalledTimes(2);
  });

  it('menu open: nav edges fire once and gameplay output is suppressed', async () => {
    const onMenuNav = vi.fn();
    const { c } = await make('playing', { isMenuOpen: () => true, onMenuNav });
    pads = [{ axes: [1, 0], buttons: btn(13, 0) }];
    expect(c.sample()).toEqual({ mx: 0, my: 0, a1: false, a2: false });
    c.sample();
    expect(onMenuNav.mock.calls).toEqual([['down'], ['select']]);
    pads = [{ axes: [0, 0], buttons: btn(1) }];
    c.sample();
    expect(onMenuNav).toHaveBeenLastCalledWith('back');
  });

  it('menu closed: nav callbacks stay silent', async () => {
    const onMenuNav = vi.fn();
    const { c } = await make('playing', { isMenuOpen: () => false, onMenuNav });
    pads = [{ axes: [0, 0], buttons: btn(12, 0, 1) }];
    c.sample();
    expect(onMenuNav).not.toHaveBeenCalled();
  });

  describe('secondary action (a2)', () => {
    it('is false by default and on the mine keys', async () => {
      const { c } = await make();
      expect(c.sample().a2).toBe(false);
      (win.keydown ?? []).forEach((f) => f(key('KeyE')));
      expect(c.sample().a2).toBe(true);
      expect(c.sample().a1).toBe(false);
      (win.keyup ?? []).forEach((f) => f({ code: 'KeyE' }));
      expect(c.sample().a2).toBe(false);
    });

    it('a tap shorter than one sample still registers once', async () => {
      const { c } = await make();
      (win.keydown ?? []).forEach((f) => f(key('KeyL')));
      (win.keyup ?? []).forEach((f) => f({ code: 'KeyL' }));
      expect(c.sample().a2).toBe(true);
      expect(c.sample().a2).toBe(false);
    });

    it('the touch cross gives digital 4-way and diagonal movement, and releases', async () => {
      const { c, cross } = await make();
      fire(cross.h, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 50, preventDefault: () => {} });
      expect(c.sample()).toMatchObject({ mx: 1, my: 0 });
      fire(cross.h, 'pointermove', { pointerId: 1, clientX: 100, clientY: 100 });
      const d = c.sample();
      expect(d.mx).toBeCloseTo(0.71, 2);
      expect(d.my).toBeCloseTo(0.71, 2);
      fire(cross.h, 'pointermove', { pointerId: 1, clientX: 50, clientY: 50 }); // centre: dead zone
      expect(c.sample()).toMatchObject({ mx: 0, my: 0 });
      fire(cross.h, 'pointermove', { pointerId: 1, clientX: 50, clientY: 0 });
      expect(c.sample()).toMatchObject({ mx: 0, my: -1 });
      fire(cross.h, 'pointerup', { pointerId: 1 });
      expect(c.sample()).toMatchObject({ mx: 0, my: 0 });
    });

    it('releaseMove drops a held cross', async () => {
      const { c, cross } = await make();
      fire(cross.h, 'pointerdown', { pointerId: 2, clientX: 0, clientY: 50, preventDefault: () => {} });
      expect(c.sample().mx).toBe(-1);
      c.releaseMove();
      expect(c.sample().mx).toBe(0);
    });

    it('the touch mine button holds and releases', async () => {
      const { c, mine } = await make();
      fire(mine.h, 'pointerdown', { preventDefault: () => {} });
      expect(c.sample().a2).toBe(true);
      expect(c.sample().a2).toBe(true); // still held
      fire(mine.h, 'pointerup');
      expect(c.sample().a2).toBe(false);
    });

    it('the gamepad B button is a2, and is suppressed while a menu is open', async () => {
      pads = [{ axes: [0, 0], buttons: Object.assign([], { 1: { pressed: true } }) }];
      const { c } = await make();
      expect(c.sample().a2).toBe(true);
      const open = await make('playing', { isMenuOpen: () => true });
      expect(open.c.sample().a2).toBe(false);
    });
  });

  describe('rebindable controls', () => {
    const keys = (c: any, code: string, extra: any = {}) => (win.keydown ?? []).forEach((f) => f({ code, target: null, preventDefault: c, ...extra }));
    const up = (code: string) => (win.keyup ?? []).forEach((f) => f({ code }));
    const withControls = async (controls: any) => {
      const { InputController } = await import('./input');
      return new InputController(el() as any, el() as any, () => 'playing', {}, el() as any, () => controls);
    };

    it('custom keys drive movement and both actions; the old keys stop working', async () => {
      const controls = { ...defaultControls(), up: ['KeyI'], action: ['KeyF'], action2: ['KeyG'] };
      const c = await withControls(controls);
      keys(() => {}, 'KeyI');
      expect(c.sample().my).toBe(-1);
      up('KeyI');
      keys(() => {}, 'KeyW'); // the old "up" is not bound any more
      expect(c.sample().my).toBe(0);
      up('KeyW');
      keys(() => {}, 'KeyF');
      expect(c.sample().a1).toBe(true);
      expect(c.sample().a2).toBe(false);
      up('KeyF');
      keys(() => {}, 'KeyG');
      expect(c.sample().a2).toBe(true);
    });

    it('Ctrl, Meta or Alt held: nothing fires and the browser shortcut is left alone', async () => {
      const c = await withControls(defaultControls());
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        const prevent = vi.fn();
        keys(prevent, 'KeyE', mod);
        keys(prevent, 'KeyW', mod);
        keys(prevent, 'Space', mod);
        expect(prevent).not.toHaveBeenCalled();
        expect(c.sample()).toMatchObject({ mx: 0, my: 0, a1: false, a2: false });
      }
    });

    it('bound keys are prevented (no page scroll), unbound ones are not', async () => {
      const c = await withControls(defaultControls());
      const bound = vi.fn();
      const other = vi.fn();
      keys(bound, 'Space');
      keys(other, 'KeyQ');
      expect(bound).toHaveBeenCalled();
      expect(other).not.toHaveBeenCalled();
      expect(c.sample().a1).toBe(true);
    });

    it('refreshControls applies new bindings to a live controller and drops stale held keys', async () => {
      let controls = defaultControls();
      const { InputController } = await import('./input');
      const c = new InputController(el() as any, el() as any, () => 'playing', {}, el() as any, () => controls);
      keys(() => {}, 'KeyW');
      expect(c.sample().my).toBe(-1);
      controls = { ...controls, up: ['KeyI'] };
      c.refreshControls();
      expect(c.sample().my).toBe(0); // KeyW no longer bound, so it no longer counts as held
    });
  });
});
