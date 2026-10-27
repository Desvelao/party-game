import type { MusicTrack } from '../../../core/client/src/plugins/api';

/** Rumble Cards: a tense, bouncy A minor riff for a card duel (about 3.7 s at 130 bpm). */
const _ = null;

export const CARDS_TRACK: MusicTrack = {
  bpm: 130,
  bass: [
    45, _, 45, _, 52, _, 45, _, // Am
    43, _, 43, _, 50, _, 52, _, // G, to E
  ],
  melody: [
    69, _, 72, 76, 74, _, 72, _,
    71, _, 74, 79, 76, 74, 72, _,
  ],
  kick: [0, 6, 8],
  snare: [4, 12],
  hat: [2, 6, 10, 14],
  gain: 0.85,
  leadWave: 'square',
};
