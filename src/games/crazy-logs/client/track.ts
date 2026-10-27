import type { MusicTrack } from '../../../core/client/src/plugins/api';

/**
 * Crazy Logs: light, rolling G major river tune - walking bass, a flowing triangle melody, brushed hats
 * (about 3.7 s at 130 bpm).
 */
const _ = null;

export const LOGS_TRACK: MusicTrack = {
  bpm: 130,
  bass: [
    43, _, 50, _, 47, _, 50, _, // G
    48, _, 55, _, 50, _, 57, _, // C, D
  ],
  melody: [
    67, 71, 74, 71, 67, _, 71, _,
    72, 76, 79, 76, 74, 71, 69, _,
  ],
  kick: [0, 8],
  snare: [4, 12],
  hat: [2, 6, 10, 14],
  gain: 0.9,
  leadWave: 'triangle',
};
