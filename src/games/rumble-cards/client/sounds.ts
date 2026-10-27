// The sounds of Rumble Cards, as data (see `SoundStep`): one cast sound per kind of effect, impact sounds that
// depend on the damage, and a few interface sounds. Pure, so they can be checked without a browser.
import type { SoundStep } from '../../../core/client/src/plugins/api';
import { CARDS, type Motif } from '../shared/cards';
import { effectFor } from './anim';

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
const T = (f: number, d: number, type: Wave, g: number, to?: number, at?: number): SoundStep => ({ k: 'tone', f, d, type, g, ...(to ? { to } : {}), ...(at ? { at } : {}) });
const N = (d: number, g: number, from: number, to: number, at?: number): SoundStep => ({ k: 'noise', d, g, from, to, ...(at ? { at } : {}) });

/** what a card sounds like when it is cast, by the kind of effect or (for damage) by its illustration */
export const CAST = {
  bolt: [T(1400, 0.05, 'square', 0.07, 900), T(1700, 0.05, 'square', 0.07, 800, 0.06), T(1200, 0.06, 'square', 0.07, 2200, 0.12), N(0.18, 0.1, 6000, 1500, 0.02)],
  swipe: [N(0.14, 0.14, 5000, 900), T(900, 0.16, 'triangle', 0.07, 300)],
  thud: [T(130, 0.22, 'sine', 0.22, 45), N(0.16, 0.14, 900, 120)],
  whoosh: [N(0.4, 0.16, 500, 4500), T(250, 0.4, 'sawtooth', 0.05, 900)],
  shimmer: [T(660, 0.16, 'sine', 0.07), T(880, 0.16, 'sine', 0.07, undefined, 0.06), T(1100, 0.16, 'sine', 0.07, undefined, 0.12), T(1320, 0.22, 'sine', 0.06, undefined, 0.18)],
  heal: [T(523, 0.18, 'sine', 0.1), T(659, 0.18, 'sine', 0.09, undefined, 0.09), T(784, 0.3, 'sine', 0.1, undefined, 0.18)],
  guard: [T(300, 0.18, 'square', 0.08, 700), T(1200, 0.1, 'triangle', 0.08, undefined, 0.14), N(0.08, 0.08, 3000, 800, 0.14)],
  wave: [N(0.7, 0.22, 200, 80), T(70, 0.7, 'sawtooth', 0.14, 42)],
  steal: [T(600, 0.2, 'sine', 0.08, 200), T(250, 0.22, 'triangle', 0.08, 700, 0.2)],
  smash: [N(0.12, 0.28, 9000, 1200), T(180, 0.14, 'square', 0.1, 60, 0.01)],
  draw: [N(0.05, 0.1, 6000, 2500), N(0.05, 0.1, 6000, 2500, 0.09)],
} satisfies Record<string, SoundStep[]>;

const SHOT_BY_MOTIF: Record<Motif, keyof typeof CAST> = {
  bolt: 'bolt',
  paw: 'swipe',
  feather: 'swipe',
  rock: 'thud',
  wall: 'thud',
  comet: 'whoosh',
  eye: 'shimmer',
  moon: 'shimmer',
  stars: 'shimmer',
  swirl: 'shimmer',
  heart: 'shimmer',
  shield: 'shimmer',
};

/** the sound of casting a card */
export function castSound(card: number): SoundStep[] {
  const { kind } = effectFor(card);
  if (kind === 'shot') return CAST[SHOT_BY_MOTIF[CARDS[card].art.m]];
  return CAST[kind];
}

/** a hit of `n` hit points: heavier ones are lower, longer and louder */
export function hitSound(n: number): SoundStep[] {
  const k = Math.min(3, Math.max(1, Math.round(n)));
  if (k === 1) return [T(180, 0.1, 'triangle', 0.18, 70), N(0.08, 0.1, 1800, 300)];
  if (k === 2) return [T(150, 0.16, 'triangle', 0.24, 50), N(0.16, 0.2, 2400, 200), T(90, 0.2, 'sine', 0.2, 40, 0.02)];
  return [T(120, 0.22, 'sawtooth', 0.2, 42), N(0.28, 0.3, 3000, 150), T(70, 0.3, 'sine', 0.28, 42, 0.02)];
}

export const BLOCK: SoundStep[] = [T(950, 0.12, 'triangle', 0.12), T(1420, 0.1, 'triangle', 0.08, undefined, 0.02), N(0.05, 0.1, 5000, 2000)];
export const BREAK: SoundStep[] = [N(0.3, 0.2, 9000, 1500), T(2200, 0.06, 'triangle', 0.06, 1200), T(1700, 0.06, 'triangle', 0.05, 900, 0.05), T(2600, 0.06, 'triangle', 0.04, 1500, 0.1)];
export const HEAL_CHIME: SoundStep[] = [T(659, 0.12, 'sine', 0.1), T(880, 0.14, 'sine', 0.08, undefined, 0.08), T(1175, 0.2, 'sine', 0.07, undefined, 0.16)];
export const KNOCK_OUT: SoundStep[] = [T(500, 0.6, 'sine', 0.2, 60), N(0.5, 0.3, 2200, 100), T(70, 0.5, 'sawtooth', 0.18, 42, 0.05)];

/** a card thrown away on purpose: a quick paper flick */
export const DISCARD: SoundStep[] = [N(0.12, 0.12, 4500, 900), T(520, 0.1, 'triangle', 0.06, 200, 0.02)];
/** a card taken from a hand that ran out of time: a crumple and a low thump */
export const DISCARD_AUTO: SoundStep[] = [N(0.26, 0.2, 3500, 500), N(0.1, 0.14, 6000, 1500, 0.08), T(110, 0.2, 'triangle', 0.16, 55, 0.04)];

/** the tick of the last seconds: `n` whole seconds left; it climbs in pitch and volume, and the final one is a double */
export function tickSound(n: number): SoundStep[] {
  const k = Math.min(5, Math.max(1, Math.round(n)));
  const f = 620 + (5 - k) * 110;
  const g = 0.05 + (5 - k) * 0.012;
  const step = T(f, 0.06, 'square', g, f * 0.8);
  return k === 1 ? [step, T(f * 1.25, 0.08, 'square', g, f, 0.12)] : [step];
}

export const UI = {
  turn: [T(660, 0.1, 'sine', 0.1), T(990, 0.2, 'sine', 0.12, undefined, 0.1)],
  pick: [T(900, 0.03, 'square', 0.04)],
  aim: [T(500, 0.04, 'triangle', 0.05, 700)],
  deal: [N(0.04, 0.08, 5000, 2500)],
} satisfies Record<string, SoundStep[]>;
