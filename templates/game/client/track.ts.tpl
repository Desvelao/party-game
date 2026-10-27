import type { MusicTrack } from '__SRC__/client/src/plugins/api';

/** __NAME__: a short placeholder loop (4 s at 120 bpm). Replace it with the game's own. */
const _ = null;

export const TRACK: MusicTrack = {
  bpm: 120,
  bass: [
    48, _, 48, _, 55, _, 55, _,
    53, _, 53, _, 55, _, 55, _,
  ],
  melody: [
    72, _, 76, _, 79, _, 76, _,
    77, _, 74, _, 79, _, _, _,
  ],
  kick: [0, 4, 8, 12],
  snare: [4, 12],
  hat: [0, 2, 4, 6, 8, 10, 12, 14],
  gain: 0.8,
};
