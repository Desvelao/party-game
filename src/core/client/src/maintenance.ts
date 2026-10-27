import type { MaintenanceInfo } from '../../shared';

const NONE: MaintenanceInfo = { draining: false, banners: [], recent: [] };
let info: MaintenanceInfo = NONE;
let listener: () => void = () => {};

/** What the server last said about drain mode and announcements. */
export const maintenanceInfo = (): MaintenanceInfo => info;

/** Called after a change, so the open banner updates in place. */
export function setOnMaintenanceChange(fn: () => void): void {
  listener = fn;
}

/** Anything to show: a drain notice, a pinned announcement or an announcement to re-read. */
export const hasAnnouncements = (m: MaintenanceInfo = info): boolean => m.draining || m.banners.length > 0 || m.recent.length > 0;

/** Keep only well-formed entries: the answer comes over the network. */
export function parseMaintenance(raw: unknown): MaintenanceInfo {
  if (typeof raw !== 'object' || raw === null) return NONE;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).message === 'string') : []);
  return {
    draining: r.draining === true,
    ...(typeof r.message === 'string' && r.message ? { message: r.message } : {}),
    banners: list(r.banners).map((b) => ({ id: String(b.id), message: String(b.message) })),
    recent: list(r.recent).map((a) => ({ id: String(a.id), message: String(a.message), at: typeof a.at === 'number' ? a.at : 0 })),
  };
}

/** Store what the server said; true when it differs from what was shown. */
export function setMaintenance(next: MaintenanceInfo): boolean {
  if (JSON.stringify(next) === JSON.stringify(info)) return false;
  info = next;
  listener();
  return true;
}

/** How long ago, as a message key and its count. */
export function ageOf(at: number, now = Date.now()): { key: 'announce.justNow' | 'announce.minutesAgo' | 'announce.hoursAgo' | 'announce.daysAgo'; n: number } {
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return { key: 'announce.justNow', n: 0 };
  if (min < 60) return { key: 'announce.minutesAgo', n: min };
  if (min < 1440) return { key: 'announce.hoursAgo', n: Math.floor(min / 60) };
  return { key: 'announce.daysAgo', n: Math.floor(min / 1440) };
}
