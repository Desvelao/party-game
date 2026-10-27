import type { MusicTrack } from '../../../core/client/src/plugins/api';

/**
 * Sprint Smash: fast, bright C major racer - galloping bass, running melody and a busy hat
 * (about 2.8 s at 170 bpm).
 */
const _ = null;

export const DASH_TRACK: MusicTrack = {
  bpm: 170,
  bass: [
    36, 36, 48, 36, 36, 36, 48, 36, // C
    41, 41, 53, 41, 43, 43, 55, 43, // F, G
  ],
  melody: [
    72, 76, 79, 84, 79, 76, 79, 76,
    77, 81, 84, 81, 79, 83, 86, 83,
  ],
  kick: [0, 4, 8, 12],
  snare: [4, 12],
  hat: [0, 2, 4, 6, 8, 10, 12, 14],
  gain: 0.85,
  bassWave: 'sawtooth',
};
