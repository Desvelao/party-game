import type { MusicTrack } from '../../../core/client/src/plugins/api';

/**
 * Frost Shove: cool, spacious F major with a slow chime melody over a soft bass - icy and wide
 * (about 4.0 s at 120 bpm).
 */
const _ = null;

export const POLAR_TRACK: MusicTrack = {
  bpm: 120,
  bass: [
    41, _, _, _, 48, _, _, _, // F
    43, _, _, _, 46, _, 48, _, // Gm, Bb
  ],
  melody: [
    77, _, 84, _, 81, _, 77, _,
    79, _, 86, _, 84, 81, 79, _,
  ],
  kick: [0, 8],
  snare: [],
  hat: [4, 12],
  gain: 0.85,
  leadWave: 'sine',
};
