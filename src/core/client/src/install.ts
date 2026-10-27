/**
 * Installing the app (PWA). The browser only offers it on a secure page (https or localhost) once the manifest
 * and the service worker are found. Chrome and Edge hand us an install prompt to trigger from a button; iOS
 * Safari has none, so the menu shows how to use "Add to Home Screen" instead.
 */
export type InstallMode = 'none' | 'prompt' | 'ios';

/** What the menu should offer. Already installed (running standalone) offers nothing. */
export function installMode(s: { standalone: boolean; hasPrompt: boolean; ios: boolean; secure: boolean }): InstallMode {
  if (s.standalone) return 'none';
  if (s.hasPrompt) return 'prompt';
  // iOS can only add to the home screen from Safari, and only offers a real app on a secure page
  return s.ios && s.secure ? 'ios' : 'none';
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true;
const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const currentInstallMode = (): InstallMode =>
  installMode({ standalone: isStandalone(), hasPrompt: deferred !== null, ios: isIos(), secure: window.isSecureContext });

/** Run `fn` whenever the install offer appears or goes away. Returns the unsubscribe function. */
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Show the browser's install dialog (only valid while `currentInstallMode()` is 'prompt'). */
export async function promptInstall(): Promise<void> {
  const ev = deferred;
  if (!ev) return;
  deferred = null;
  notify();
  await ev.prompt();
  await ev.userChoice.catch(() => undefined);
}

/** Register the service worker and start listening for the install offer. Safe to call anywhere: it does nothing without support. */
export function setupInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
  }
}
