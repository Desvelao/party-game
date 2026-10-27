/** Keeps the screen on while a round runs, so a phone controller does not dim, lock and drop out. */
let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  try {
    const s = await navigator.wakeLock?.request('screen');
    if (!s) return;
    if (!wanted) return void s.release().catch(() => {});
    sentinel = s;
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null;
    });
  } catch {
    /* unsupported, insecure context, or denied (e.g. low battery): the game works without it */
  }
}

/** Ask for (true) or give back (false) the screen wake lock. Safe to call on every render. */
export function setWakeLock(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else if (sentinel) {
    const s = sentinel;
    sentinel = null;
    s.release().catch(() => {});
  }
}

// the browser drops the lock when the tab is hidden; take it again on return
document.addEventListener('visibilitychange', () => void acquire());
