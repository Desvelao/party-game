import { describe, expect, it } from 'vitest';
import { ageOf, hasAnnouncements, parseMaintenance, setMaintenance, maintenanceInfo } from './maintenance';

describe('maintenance (client)', () => {
  it('parses what the server sends and drops malformed entries', () => {
    const m = parseMaintenance({ draining: true, message: 'Back at 8', banners: [{ id: 'a', message: 'Hi' }, { id: 'b' }, 7], recent: [{ id: 'c', message: 'Old', at: 5 }] });
    expect(m).toEqual({ draining: true, message: 'Back at 8', banners: [{ id: 'a', message: 'Hi' }], recent: [{ id: 'c', message: 'Old', at: 5 }] });
    expect(parseMaintenance(null)).toEqual({ draining: false, banners: [], recent: [] });
    expect(hasAnnouncements(parseMaintenance({}))).toBe(false);
  });

  it('reports a change only when the state differs', () => {
    const next = parseMaintenance({ draining: true, banners: [], recent: [] });
    expect(setMaintenance(next)).toBe(true);
    expect(setMaintenance(parseMaintenance({ draining: true }))).toBe(false);
    expect(maintenanceInfo().draining).toBe(true);
    setMaintenance(parseMaintenance({}));
  });

  it('words ages', () => {
    const now = 10_000_000;
    expect(ageOf(now - 20_000, now)).toEqual({ key: 'announce.justNow', n: 0 });
    expect(ageOf(now - 5 * 60_000, now)).toEqual({ key: 'announce.minutesAgo', n: 5 });
    expect(ageOf(now - 3 * 3_600_000, now)).toEqual({ key: 'announce.hoursAgo', n: 3 });
    expect(ageOf(now - 2 * 86_400_000, now)).toEqual({ key: 'announce.daysAgo', n: 2 });
  });
});
