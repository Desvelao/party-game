import type { MusicTrack } from '../../../core/client/src/plugins/api';

/**
 * Tank Wars: martial, slow C minor march - low plodding bass, a call-and-answer horn line and a
 * stomping kick (about 4.1 s at 116 bpm).
 */
const _ = null;

export const TANKS_TRACK: MusicTrack = {
  bpm: 116,
  bass: [
    36, _, 36, _, 43, _, 36, _, // Cm
    32, _, 32, _, 34, _, 31, _, // Ab, Bb, G
  ],
  melody: [
    60, _, _, 63, 67, _, 63, _,
    68, _, _, 65, 62, _, 59, _,
  ],
  kick: [0, 2, 4, 6, 8, 10, 12, 14],
  snare: [4, 12],
  hat: [],
  gain: 0.95,
  leadWave: 'sawtooth',
};
