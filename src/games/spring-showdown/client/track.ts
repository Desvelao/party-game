import type { MusicTrack } from '../../../core/client/src/plugins/api';

/**
 * Pogo family: a bouncy two-bar C major loop (about 3.4 s at 140 bpm) - hopping bass, a hook that
 * leaps up the pentatonic scale, kick on the beats and offbeat hats.
 * Steps are eighth notes; MIDI 48 = C3, 72 = C5.
 */
const _ = null;

export const POGO_TRACK: MusicTrack = {
  bpm: 140,
  bass: [
    48, _, 55, _, 48, _, 55, _, // C
    53, _, 60, _, 55, _, 62, _, // F, G
  ],
  melody: [
    72, _, 76, _, 79, 76, 72, _,
    77, _, 81, 79, 77, _, 74, _,
  ],
  kick: [0, 4, 8, 12],
  snare: [6, 14],
  hat: [1, 3, 5, 7, 9, 11, 13, 15],
  gain: 1,
};
