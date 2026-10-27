/**
 * Accessibility display options. Stored in the profile for registered players and in the browser
 * (session/local storage) otherwise.
 */
export interface AccessPrefs {
  /** use a colour-blind-safe palette for players and teams */
  colorblind: boolean;
  /** add a number and shape marker to every player's name label, so colour is never the only cue */
  markers: boolean;
  /** screen-shake and motion level; `auto` follows the device's reduced-motion setting */
  motion: MotionLevel;
}

export const MOTION_LEVELS = ['auto', 'off', 'low', 'normal'] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];

export function defaultAccessPrefs(): AccessPrefs {
  return { colorblind: false, markers: false, motion: 'auto' };
}

export function sanitizeAccessPrefs(raw: unknown): AccessPrefs {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const motion = (MOTION_LEVELS as readonly unknown[]).includes(r.motion) ? (r.motion as MotionLevel) : 'auto';
  return { colorblind: r.colorblind === true, markers: r.markers === true, motion };
}

export function isDefaultAccessPrefs(p: AccessPrefs): boolean {
  return !p.colorblind && !p.markers && p.motion === 'auto';
}

/** The effective level once `auto` has been resolved against the device preference. */
export function resolveMotion(level: MotionLevel, prefersReduced: boolean): Exclude<MotionLevel, 'auto'> {
  return level === 'auto' ? (prefersReduced ? 'off' : 'normal') : level;
}

/** How much of a camera shake to play: 0 (none), 0.4 (low) or 1 (normal). */
export function shakeScale(level: MotionLevel, prefersReduced: boolean): number {
  const m = resolveMotion(level, prefersReduced);
  return m === 'off' ? 0 : m === 'low' ? 0.4 : 1;
}

/** Player colours (0xRRGGBB, one per PALETTE slot): Okabe-Ito hues, then darker variants of them. */
const OKABE_ITO = [0xe69f00, 0x56b4e9, 0x009e73, 0xf0e442, 0x0072b2, 0xd55e00, 0xcc79a7, 0xdddddd];
const darker = (c: number): number =>
  (Math.round(((c >> 16) & 255) * 0.55) << 16) | (Math.round(((c >> 8) & 255) * 0.55) << 8) | Math.round((c & 255) * 0.55);
export const COLORBLIND_PALETTE: number[] = [...OKABE_ITO, ...OKABE_ITO.map(darker)];

/** Team colours that stay apart for the common colour-vision deficiencies. */
export const COLORBLIND_TEAM_PALETTE = [0xe69f00, 0x56b4e9, 0xcc79a7, 0x009e73];

/** Marker glyphs, cycled by seat; combined with the seat number they identify a player without colour. */
export const MARKER_SHAPES = ['●', '▲', '■', '◆', '★', '✚', '⬟', '⬢'] as const;

/** `▲2` for the player at seat index 1. */
export function markerFor(index: number): string {
  return `${MARKER_SHAPES[index % MARKER_SHAPES.length]}${index + 1}`;
}
