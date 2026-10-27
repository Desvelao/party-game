// The missile sounds of Spring Showdown, as data (see `SoundStep`), and the diff that decides which one a frame plays.
// Pure, so they can be checked without a browser.
import type { SoundStep } from '../../../core/client/src/plugins/api';

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
const T = (f: number, d: number, type: Wave, g: number, to?: number, at?: number): SoundStep => ({ k: 'tone', f, d, type, g, ...(to ? { to } : {}), ...(at ? { at } : {}) });
const N = (d: number, g: number, from: number, to: number, at?: number): SoundStep => ({ k: 'noise', d, g, from, to, ...(at ? { at } : {}) });

export const MISSILE_SOUNDS = {
  /** a player fires: a quick rising whoosh */
  launch: [N(0.2, 0.14, 800, 4500), T(300, 0.2, 'sawtooth', 0.07, 900)],
  /** Blast Bot fires from the edge: lower and longer, so it reads as a hazard */
  bomber: [T(160, 0.4, 'sawtooth', 0.12, 90), N(0.4, 0.12, 400, 120), T(90, 0.3, 'square', 0.06, 60, 0.08)],
  /** a missile hits someone */
  hit: [T(220, 0.15, 'square', 0.12, 60), N(0.15, 0.14, 3000, 500)],
} satisfies Record<string, SoundStep[]>;

export interface MissilePos {
  x: number;
  y: number;
}

/**
 * Which missile sounds this frame plays: `launch` / `bomber` for ids not seen last frame (a four-way volley is one sound;
 * `bomber` when one spawned on the board edge), `hit` for ids that vanished inside the board. `prev` is updated to the
 * current missiles. With no previous frame (`first`) nothing plays, so joining mid-round is silent.
 */
export function missileSounds(prev: Map<number, MissilePos>, current: readonly { id: number; x: number; y: number }[], n: number, first: boolean): (keyof typeof MISSILE_SOUNDS)[] {
  const out: (keyof typeof MISSILE_SOUNDS)[] = [];
  if (prev.size === 0 && current.length === 0) return out;
  let launch = false;
  let bomber = false;
  for (const m of current) {
    if (prev.has(m.id)) continue;
    if (m.x < 0.1 || m.y < 0.1 || m.x > n - 0.1 || m.y > n - 0.1) bomber = true;
    else launch = true;
  }
  let hit = false;
  if (prev.size > 0) {
    const alive = new Set<number>();
    for (const m of current) alive.add(m.id);
    for (const [id, p] of prev) if (!alive.has(id) && p.x > 0.5 && p.y > 0.5 && p.x < n - 0.5 && p.y < n - 0.5) hit = true;
  }
  prev.clear();
  for (const m of current) prev.set(m.id, { x: m.x, y: m.y });
  if (first) return out;
  if (bomber) out.push('bomber');
  if (launch) out.push('launch');
  if (hit) out.push('hit');
  return out;
}

export const BOOTS_SOUNDS = {
  /** the pulse while the boots last: a quiet rising chirp */
  zip: [T(700, 0.09, 'square', 0.2, 1400), N(0.04, 0.1, 6000, 2500)],
  /** the last second and a half: lower and faster */
  hurry: [T(500, 0.09, 'sawtooth', 0.24, 900)],
  /** the boots wore off (or a stun took them) */
  end: [T(800, 0.3, 'sine', 0.28, 200), T(300, 0.25, 'sawtooth', 0.14, 100)],
} satisfies Record<string, SoundStep[]>;

const BOOTS_PULSE_MS = 300;
const BOOTS_HURRY_MS = 180;
/** `boots` (1 -> 0 over BOOTS_TIME = 8 s) under which the pulse hurries: the last 1.5 s */
const BOOTS_HURRY_AT = 1.5 / 8;

/**
 * The boots sound of this frame, or null: `end` on the edge to 0, otherwise a `zip` (`hurry` near the end) every
 * pulse while `boots` > 0. `prev` is last frame's value, `lastMs` when a pulse last played.
 */
export function bootsSound(prev: number, boots: number, nowMs: number, lastMs: number): keyof typeof BOOTS_SOUNDS | null {
  if (boots <= 0) return prev > 0 ? 'end' : null;
  const hurry = boots < BOOTS_HURRY_AT;
  if (nowMs - lastMs < (hurry ? BOOTS_HURRY_MS : BOOTS_PULSE_MS)) return null;
  return hurry ? 'hurry' : 'zip';
}
