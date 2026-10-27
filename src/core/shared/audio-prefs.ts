/**
 * Volume settings, 0..100 each. Stored in the profile for registered players and in the browser
 * (session/local storage) otherwise. Muting is a separate switch (audio/mute.ts).
 */
export interface AudioPrefs {
  master: number;
  sfx: number;
  music: number;
}

export function defaultAudioPrefs(): AudioPrefs {
  return { master: 100, sfx: 100, music: 100 };
}

const level = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback;

export function sanitizeAudioPrefs(raw: unknown): AudioPrefs {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = defaultAudioPrefs();
  return { master: level(r.master, d.master), sfx: level(r.sfx, d.sfx), music: level(r.music, d.music) };
}

export function isDefaultAudioPrefs(p: AudioPrefs): boolean {
  const d = defaultAudioPrefs();
  return p.master === d.master && p.sfx === d.sfx && p.music === d.music;
}
