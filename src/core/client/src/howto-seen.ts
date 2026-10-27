export const HOWTO_SEEN_KEY = 'party-game:howto-seen';

let memory = new Set<string>(); // page-lifetime copy, used when storage is unavailable

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(HOWTO_SEEN_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set([...memory, ...(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [])]);
  } catch {
    return memory;
  }
}

/** Has this browser already shown the first-run "how to play" card for this game/variant id? */
export function hasSeenHowTo(id: string): boolean {
  return read().has(id);
}

export function markHowToSeen(id: string): void {
  memory = new Set([...memory, id]);
  try {
    localStorage.setItem(HOWTO_SEEN_KEY, JSON.stringify([...read()]));
  } catch {
    /* storage unavailable: remembered for this page only */
  }
}
