export const MUTE_KEY = 'party-game:muted';

type Store = Pick<Storage, 'getItem'>;
type WStore = Pick<Storage, 'setItem'>;

/** Reads the persisted mute flag; unmuted unless explicitly stored as '1'. Never throws. */
export function loadMuted(storage?: Store): boolean {
  try {
    return (storage ?? localStorage).getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean, storage?: WStore): void {
  try {
    (storage ?? localStorage).setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode */
  }
}
