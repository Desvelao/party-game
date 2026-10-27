// Snapshots carry positions only; this derives velocities by matching entities across snapshots.

export interface Track {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** game time of the last observation, s */
  t: number;
  /** false until two observations gave a velocity */
  known: boolean;
}

export type Advance = (prev: Track, dt: number) => { x: number; y: number; vx: number; vy: number } | null;

/**
 * Velocity estimator. If the caller can simulate the entity forward (`advance`, e.g. with wall bounces) and the
 * simulation lands on the observed position, the simulated velocity is used: it is exact even if the entity
 * bounced between two snapshots. Otherwise it falls back to the finite difference.
 */
export class EntityTracker {
  private tracks = new Map<number | string, Track>();
  corrected = 0;
  fallback = 0;

  constructor(private readonly tolerance = 4) {}

  observe(id: number | string, x: number, y: number, t: number, advance?: Advance): Track {
    const prev = this.tracks.get(id);
    if (!prev) {
      const tr: Track = { x, y, vx: 0, vy: 0, t, known: false };
      this.tracks.set(id, tr);
      return tr;
    }
    const dt = t - prev.t;
    if (dt <= 1e-6) return prev;
    const sim = advance && prev.known ? advance(prev, dt) : null;
    if (sim && Math.hypot(sim.x - x, sim.y - y) <= this.tolerance) {
      prev.vx = sim.vx;
      prev.vy = sim.vy;
      this.corrected++;
    } else {
      prev.vx = (x - prev.x) / dt;
      prev.vy = (y - prev.y) / dt;
      this.fallback++;
    }
    prev.x = x;
    prev.y = y;
    prev.t = t;
    prev.known = true;
    return prev;
  }

  reset(id: number | string): void {
    this.tracks.delete(id);
  }

  /** forget entities that were not in the latest snapshot */
  prune(keep: Set<number | string>): void {
    for (const id of this.tracks.keys()) if (!keep.has(id)) this.tracks.delete(id);
  }
}
