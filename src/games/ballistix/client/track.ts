import type { MusicTrack } from '../../../core/client/src/plugins/api';

/**
 * Ballistix: electronic D minor - pumping sixteenth-feel bass and an arpeggiated lead, four-on-the-floor
 * (about 3.0 s at 160 bpm).
 */
const _ = null;

export const BALLISTIX_TRACK: MusicTrack = {
  bpm: 160,
  bass: [
    38, 38, _, 38, 38, _, 38, 38, // Dm
    34, 34, _, 34, 36, _, 36, 36, // Bb, C
  ],
  melody: [
    62, 65, 69, 74, 69, 65, 62, _,
    58, 62, 65, 70, 72, 69, 65, _,
  ],
  kick: [0, 2, 4, 6, 8, 10, 12, 14],
  snare: [4, 12],
  hat: [1, 3, 5, 7, 9, 11, 13, 15],
  gain: 0.9,
  bassWave: 'sawtooth',
};
