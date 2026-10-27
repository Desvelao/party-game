/**
 * On-screen (touch) control preferences: whether to show the controls and which move control to use
 * (joystick or 4-way cross), globally or per game. Pure: shared by the client and the profile store.
 */
export type MoveControl = 'joystick' | 'cross';
export type MovePref = 'auto' | MoveControl;
export type ShowPref = 'auto' | 'on' | 'off';
export type SizePref = 'small' | 'medium' | 'large';
export type HandPref = 'right' | 'left';

export const SIZE_PREFS: readonly SizePref[] = ['small', 'medium', 'large'];
export const HAND_PREFS: readonly HandPref[] = ['right', 'left'];
export const MIN_OPACITY = 30;
export const MAX_OPACITY = 100;

export interface TouchPrefs {
  /** on-screen controls: auto = only on touch screens */
  show: ShowPref;
  /** move control for every game; auto = follow the game's hint */
  move: MovePref;
  /** per game (catalog game id) override of `move`; absent = follow `move` */
  perGame?: Record<string, MoveControl>;
  /** size of the on-screen controls */
  size: SizePref;
  /** opacity of the on-screen controls in percent (30-100) */
  opacity: number;
  /** which side the move control sits on; the action buttons take the other */
  hand: HandPref;
  /** vibrate on hits and eliminations (phones that support it) */
  haptics: boolean;
  /** the joystick appears where the thumb lands instead of staying on its fixed base */
  floating: boolean;
}

export const DEFAULT_TOUCH_PREFS: TouchPrefs = {
  show: 'auto',
  move: 'auto',
  size: 'medium',
  opacity: MAX_OPACITY,
  hand: 'right',
  haptics: true,
  floating: false,
};

export const MAX_PER_GAME = 32;
const GAME_ID_RE = /^[a-z0-9-]{1,48}$/;

export const MOVE_CONTROLS: readonly MoveControl[] = ['joystick', 'cross'];

export function defaultTouchPrefs(): TouchPrefs {
  return { ...DEFAULT_TOUCH_PREFS };
}

function isMove(v: unknown): v is MoveControl {
  return v === 'joystick' || v === 'cross';
}

/** Validate untrusted prefs; unknown/invalid parts fall back to the defaults. */
export function sanitizeTouchPrefs(raw: unknown): TouchPrefs {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = defaultTouchPrefs();
  if (src.show === 'on' || src.show === 'off') out.show = src.show;
  if (isMove(src.move)) out.move = src.move;
  if (SIZE_PREFS.includes(src.size as SizePref)) out.size = src.size as SizePref;
  if (typeof src.opacity === 'number' && Number.isFinite(src.opacity)) {
    out.opacity = Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Math.round(src.opacity)));
  }
  if (HAND_PREFS.includes(src.hand as HandPref)) out.hand = src.hand as HandPref;
  if (src.haptics === false) out.haptics = false;
  if (src.floating === true) out.floating = true;
  const pg = src.perGame;
  if (typeof pg === 'object' && pg !== null && !Array.isArray(pg)) {
    const perGame: Record<string, MoveControl> = {};
    for (const [k, v] of Object.entries(pg as Record<string, unknown>)) {
      if (Object.keys(perGame).length >= MAX_PER_GAME) break;
      if (GAME_ID_RE.test(k) && isMove(v)) perGame[k] = v;
    }
    if (Object.keys(perGame).length > 0) out.perGame = perGame;
  }
  return out;
}

export function isDefaultTouchPrefs(p: TouchPrefs): boolean {
  const d = DEFAULT_TOUCH_PREFS;
  return (
    p.show === d.show && p.move === d.move && p.size === d.size && p.opacity === d.opacity &&
    p.hand === d.hand && p.haptics === d.haptics && p.floating === d.floating && Object.keys(p.perGame ?? {}).length === 0
  );
}

/** Per-game override > global preference > the game's hint > joystick. */
export function resolveMoveControl(prefs: TouchPrefs, gameId: string | undefined, hint?: MoveControl): MoveControl {
  const own = gameId ? prefs.perGame?.[gameId] : undefined;
  if (own) return own;
  if (prefs.move !== 'auto') return prefs.move;
  return hint ?? 'joystick';
}

/** Touch screens always get the controls (they are the only way to play); others follow the preference. */
export function resolveShowControls(prefs: TouchPrefs, isTouch: boolean): boolean {
  return isTouch || prefs.show === 'on';
}
