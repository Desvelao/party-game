/**
 * Sound recipes: a few synth steps as data, so a game pack can have its own sounds without shipping audio files
 * (like `MusicTrack` for music). The core plays them through the same synth as its built-in effects.
 */
export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** One voice: a tone (optionally gliding to `to` Hz) or a burst of noise sweeping `from` -> `to` Hz. `at`: seconds after the start. */
export type SoundStep =
  | { k: 'tone'; f: number; d: number; type?: Wave; g?: number; to?: number; at?: number }
  | { k: 'noise'; d: number; g?: number; from: number; to: number; at?: number };

/** Limits that keep a pack's sounds short, quiet enough and cheap for small devices. */
export const MAX_STEPS = 10;
const HZ_MIN = 40;
const HZ_MAX = 8000;
const NOISE_MIN = 80;
const NOISE_MAX = 12000;
const DUR_MIN = 0.02;
const DUR_MAX = 1.5;
const GAIN_MAX = 0.35;
const AT_MAX = 2;
const WAVES: readonly string[] = ['sine', 'square', 'sawtooth', 'triangle'];

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep the valid steps (at most MAX_STEPS) with every value inside its limits; junk is dropped, never thrown. */
export function sanitizeSound(steps: unknown): SoundStep[] {
  if (!Array.isArray(steps)) return [];
  const out: SoundStep[] = [];
  for (const raw of steps.slice(0, MAX_STEPS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (!num(s.d)) continue;
    const common = {
      d: clamp(s.d, DUR_MIN, DUR_MAX),
      g: num(s.g) ? clamp(s.g, 0, GAIN_MAX) : 0.1,
      at: num(s.at) ? clamp(s.at, 0, AT_MAX) : 0,
    };
    if (s.k === 'tone' && num(s.f)) {
      out.push({
        k: 'tone',
        f: clamp(s.f, HZ_MIN, HZ_MAX),
        type: typeof s.type === 'string' && WAVES.includes(s.type) ? (s.type as Wave) : 'sine',
        ...(num(s.to) ? { to: clamp(s.to, HZ_MIN, HZ_MAX) } : {}),
        ...common,
      });
    } else if (s.k === 'noise' && num(s.from) && num(s.to)) {
      out.push({ k: 'noise', from: clamp(s.from, NOISE_MIN, NOISE_MAX), to: clamp(s.to, NOISE_MIN, NOISE_MAX), ...common });
    }
  }
  return out;
}
