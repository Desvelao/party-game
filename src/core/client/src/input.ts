import { isFormControl, shouldCaptureKey, type KeyTargetInfo } from './keycapture';
// the pure module, not the shared index: this file must stay free of i18n/DOM globals at import time
import { defaultControls, type Controls } from '../../shared/controls';

export interface InputSample {
  mx: number;
  my: number;
  a1: boolean;
  a2: boolean;
}

export type MenuNav = 'up' | 'down' | 'select' | 'back';

export interface GamepadMenuOptions {
  /** Start pressed (edge-triggered). */
  onMenuButton?: () => void;
  /** True while a menu/dialog owns the pad: movement and dash are suppressed, nav edges go to onMenuNav. */
  isMenuOpen?: () => boolean;
  /** d-pad up/down, A, B pressed (edge-triggered) while the menu is open. */
  onMenuNav?: (nav: MenuNav) => void;
}

const PAD_START = 9;
const PAD_DPAD = { up: 12, down: 13, left: 14, right: 15 };
const PAD_EDGES = [0, 1, PAD_START, PAD_DPAD.up, PAD_DPAD.down];

/** Keyboard + touch/mouse joystick + gamepad -> one set of intentions. */
export class InputController {
  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private dashHeld = false;
  /** A tap shorter than one send interval must still register once. */
  private dashLatched = false;
  private mineHeld = false;
  private mineLatched = false;
  /** Gamepad buttons held at the previous sample, for edge detection. */
  private padHeld = new Set<number>();
  /** key sets of the current (rebindable) keyboard controls */
  private upKeys = new Set<string>();
  private downKeys = new Set<string>();
  private leftKeys = new Set<string>();
  private rightKeys = new Set<string>();
  private actionKeys = new Set<string>();
  private action2Keys = new Set<string>();
  private bound = new Set<string>();

  constructor(
    private readonly joystick: HTMLElement,
    private readonly dashBtn: HTMLElement,
    private readonly getPhase: () => string = () => 'playing',
    private readonly pad: GamepadMenuOptions = {},
    private readonly mineBtn?: HTMLElement,
    private readonly getControls: () => Controls = defaultControls,
    private readonly crossEl?: HTMLElement,
  ) {
    this.refreshControls();
    const info = (t: EventTarget | null): KeyTargetInfo | null => {
      const el = t as HTMLElement | null;
      return el && el.tagName ? { tagName: el.tagName, id: el.id, isContentEditable: el.isContentEditable } : null;
    };
    const reset = () => {
      this.keys.clear();
      this.dashLatched = false;
      this.mineLatched = false;
    };
    window.addEventListener('keydown', (e) => {
      // browser shortcuts (Ctrl+W, Ctrl+S, Alt+Left...) are never game input and are left alone
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!shouldCaptureKey(this.getPhase(), info(e.target), e.code)) return;
      if (!this.bound.has(e.code)) return;
      if (this.actionKeys.has(e.code)) this.dashLatched = true;
      if (this.action2Keys.has(e.code)) this.mineLatched = true;
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('focusin', (e) => {
      if (isFormControl(info(e.target))) reset();
    });
    this.bindJoystick();
    this.bindCross();
    this.bindDash();
    this.bindMine();
  }

  /** Re-read the key bindings (call after they change). */
  refreshControls(): void {
    const c = this.getControls();
    this.upKeys = new Set(c.up);
    this.downKeys = new Set(c.down);
    this.leftKeys = new Set(c.left);
    this.rightKeys = new Set(c.right);
    this.actionKeys = new Set(c.action);
    this.action2Keys = new Set(c.action2);
    this.bound = new Set([...c.up, ...c.down, ...c.left, ...c.right, ...c.action, ...c.action2]);
    // a key that is no longer bound must not stay "held"
    for (const k of [...this.keys]) if (!this.bound.has(k)) this.keys.delete(k);
  }

  private anyHeld(set: Set<string>): boolean {
    for (const c of this.keys) if (set.has(c)) return true;
    return false;
  }

  /** Floating stick: move the base so its centre is under the thumb (kept fully on screen). */
  private recentre(e: PointerEvent): void {
    this.joystick.style.translate = '';
    const r = this.joystick.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, r.width / 2), window.innerWidth - r.width / 2);
    const y = Math.min(Math.max(e.clientY, r.height / 2), window.innerHeight - r.height / 2);
    this.joystick.style.translate = `${x - (r.left + r.width / 2)}px ${y - (r.top + r.height / 2)}px`;
  }

  private bindJoystick(): void {
    const knob = this.joystick.querySelector<HTMLElement>('.knob')!;
    const maxR = 43;
    let activeId: number | null = null;
    const move = (e: PointerEvent) => {
      const r = this.joystick.getBoundingClientRect();
      const k = r.width / (this.joystick.offsetWidth || r.width || 1); // size preference scales the stick
      let dx = (e.clientX - (r.left + r.width / 2)) / k;
      let dy = (e.clientY - (r.top + r.height / 2)) / k;
      const len = Math.hypot(dx, dy);
      if (len > maxR) {
        dx = (dx / len) * maxR;
        dy = (dy / len) * maxR;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy.x = dx / maxR;
      this.joy.y = dy / maxR;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      this.joy.x = this.joy.y = 0;
      knob.style.transform = '';
      this.joystick.style.translate = ''; // a floating stick goes back to its base
    };
    this.joystick.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId;
      this.joystick.setPointerCapture(e.pointerId);
      if (this.joystick.classList.contains('floating')) this.recentre(e);
      move(e);
    });
    this.joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId === activeId) move(e);
    });
    this.joystick.addEventListener('pointerup', end);
    this.joystick.addEventListener('pointercancel', end);
  }

  /**
   * 4-way cross: the pad is split in zones around its centre. Sliding from one arrow to another works,
   * and two neighbouring arrows (a corner) give a diagonal. Digital output, same slot as the joystick.
   */
  private bindCross(): void {
    const el = this.crossEl;
    if (!el) return;
    let activeId: number | null = null;
    const dead = 0.22; // fraction of the half-size
    const update = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const x = Math.abs(nx) > dead ? Math.sign(nx) : 0;
      const y = Math.abs(ny) > dead ? Math.sign(ny) : 0;
      this.joy.x = x;
      this.joy.y = y;
      el.dataset.x = String(x);
      el.dataset.y = String(y);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      this.clearCross();
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeId = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      update(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === activeId) update(e);
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    this.clearCross = () => {
      activeId = null;
      this.joy.x = this.joy.y = 0;
      delete el.dataset.x;
      delete el.dataset.y;
    };
  }

  /** Release whatever the cross is holding (also used when the move control is switched). */
  private clearCross: () => void = () => {};

  /** Release the on-screen move control (call when it is switched or hidden). */
  releaseMove(): void {
    this.clearCross();
    this.joy.x = this.joy.y = 0;
    const knob = this.joystick.querySelector<HTMLElement>('.knob');
    if (knob) knob.style.transform = '';
  }

  private bindDash(): void {
    this.dashBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.dashHeld = true;
      this.dashLatched = true;
    });
    const up = () => (this.dashHeld = false);
    this.dashBtn.addEventListener('pointerup', up);
    this.dashBtn.addEventListener('pointercancel', up);
    this.dashBtn.addEventListener('pointerleave', up);
  }

  private bindMine(): void {
    const btn = this.mineBtn;
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.mineHeld = true;
      this.mineLatched = true;
    });
    const up = () => (this.mineHeld = false);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  /** Sample current intentions; consumes the dash latch. */
  sample(): InputSample {
    let mx = 0;
    let my = 0;
    if (this.anyHeld(this.leftKeys)) mx -= 1;
    if (this.anyHeld(this.rightKeys)) mx += 1;
    if (this.anyHeld(this.upKeys)) my -= 1;
    if (this.anyHeld(this.downKeys)) my += 1;
    let a1 = this.dashHeld || this.dashLatched || this.anyHeld(this.actionKeys);
    let a2 = this.mineHeld || this.mineLatched || this.anyHeld(this.action2Keys);

    if (this.joy.x !== 0 || this.joy.y !== 0) {
      mx = this.joy.x;
      my = this.joy.y;
    }

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const down = new Set<number>();
    let dx = 0;
    let dy = 0;
    let stick = false;
    for (const pad of pads) {
      if (!pad) continue;
      const gx = pad.axes[0] ?? 0;
      const gy = pad.axes[1] ?? 0;
      if (Math.hypot(gx, gy) > 0.2) {
        mx = gx;
        my = gy;
        stick = true;
      }
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      if (b(PAD_DPAD.left)) dx -= 1;
      if (b(PAD_DPAD.right)) dx += 1;
      if (b(PAD_DPAD.up)) dy -= 1;
      if (b(PAD_DPAD.down)) dy += 1;
      for (const i of PAD_EDGES) if (b(i)) down.add(i);
      if (b(0) || b(2)) a1 = true;
      if (b(1) || b(3)) a2 = true;
    }
    // The d-pad drives movement only when the stick is idle.
    if (!stick && (dx !== 0 || dy !== 0)) {
      mx = dx;
      my = dy;
    }

    const pressed = (i: number) => down.has(i) && !this.padHeld.has(i);
    const menuOpen = this.pad.isMenuOpen?.() ?? false;
    if (pressed(PAD_START)) this.pad.onMenuButton?.();
    if (menuOpen) {
      if (pressed(PAD_DPAD.up)) this.pad.onMenuNav?.('up');
      if (pressed(PAD_DPAD.down)) this.pad.onMenuNav?.('down');
      if (pressed(0)) this.pad.onMenuNav?.('select');
      if (pressed(1)) this.pad.onMenuNav?.('back');
      // Never steer or dash through a menu.
      mx = 0;
      my = 0;
      a1 = false;
      a2 = false;
    }
    this.padHeld = down;

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.dashLatched = false;
    this.mineLatched = false;
    return { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, a1, a2 };
  }
}
