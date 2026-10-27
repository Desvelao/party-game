import { EMOTES } from './constants';
import { isBindableCode } from './controls';

/**
 * Keys for the emote bar: one to open/close it and one per reaction (`KeyboardEvent.code` values).
 * Stored in the profile for registered players and in the browser (session/local storage) otherwise.
 */
export interface EmoteKeys {
  toggle: string;
  emotes: string[];
}

export function defaultEmoteKeys(): EmoteKeys {
  return { toggle: 'KeyT', emotes: EMOTES.map((_, i) => `Digit${i + 1}`) };
}

/** Validate untrusted keys: unbindable or repeated ones fall back to the default (or are skipped if that is taken). */
export function sanitizeEmoteKeys(raw: unknown): EmoteKeys {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const def = defaultEmoteKeys();
  const taken = new Set<string>();
  const pick = (value: unknown, fallback: string): string => {
    const code = isBindableCode(value) && !taken.has(value) ? value : taken.has(fallback) ? '' : fallback;
    if (code) taken.add(code);
    return code;
  };
  const toggle = pick(src.toggle, def.toggle) || def.toggle;
  const list = Array.isArray(src.emotes) ? src.emotes : [];
  const emotes = def.emotes.map((d, i) => pick(list[i], d));
  return { toggle, emotes };
}

export function isDefaultEmoteKeys(k: EmoteKeys): boolean {
  const d = defaultEmoteKeys();
  return k.toggle === d.toggle && k.emotes.every((c, i) => c === d.emotes[i]);
}
