import type { MusicTrack } from '../../../core/client/src/plugins/api';

/**
 * Box Bonanza: chunky E minor - marching bass, short brass-like stabs and a heavy snare on the backbeat
 * (about 3.4 s at 140 bpm).
 */
const _ = null;

export const CRATES_TRACK: MusicTrack = {
  bpm: 140,
  bass: [
    40, _, 40, 47, 40, _, 40, 47, // Em
    43, _, 43, 50, 45, _, 47, _, // G, A, B
  ],
  melody: [
    _, _, 64, _, _, _, 67, _,
    _, _, 71, _, 69, _, 67, _,
  ],
  kick: [0, 3, 8, 11],
  snare: [4, 12],
  hat: [2, 6, 10, 14],
  gain: 0.95,
  bassWave: 'square',
  leadWave: 'sawtooth',
};
