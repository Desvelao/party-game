import { performance } from 'node:perf_hooks';

/** Max catch-up steps per wakeup before we give up and resync. */
const MAX_CATCHUP = 5;

export interface LoopStats {
  ticks: number;
  overruns: number;
  avgStepMs: number;
  maxStepMs: number;
  avgLagMs: number;
  maxLagMs: number;
}

/**
 * Fixed-timestep loop on setTimeout with drift correction. Lag = how late a
 * tick started relative to its schedule: the key "tick stability" metric.
 */
export class GameLoop {
  private readonly stepMs: number;
  private timer: NodeJS.Timeout | null = null;
  private nextAt = 0;
  private s = GameLoop.emptyStats();

  constructor(
    tickRate: number,
    private readonly step: (dtSeconds: number) => void,
  ) {
    this.stepMs = 1000 / tickRate;
  }

  private static emptyStats() {
    return { ticks: 0, overruns: 0, stepSum: 0, stepMax: 0, lagSum: 0, lagMax: 0 };
  }

  start(): void {
    this.nextAt = performance.now() + this.stepMs;
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Snapshot stats; pass reset=true to start a fresh measurement window. */
  stats(reset = false): LoopStats {
    const s = this.s;
    const out: LoopStats = {
      ticks: s.ticks,
      overruns: s.overruns,
      avgStepMs: s.ticks ? s.stepSum / s.ticks : 0,
      maxStepMs: s.stepMax,
      avgLagMs: s.ticks ? s.lagSum / s.ticks : 0,
      maxLagMs: s.lagMax,
    };
    if (reset) this.s = GameLoop.emptyStats();
    return out;
  }

  private schedule(): void {
    const delay = Math.max(0, this.nextAt - performance.now());
    this.timer = setTimeout(() => this.run(), delay);
  }

  private run(): void {
    try {
      this.tick();
    } finally {
      this.schedule();
    }
  }

  private tick(): void {
    let now = performance.now();
    let steps = 0;
    while (this.nextAt <= now && steps < MAX_CATCHUP) {
      const lag = now - this.nextAt;
      const t0 = performance.now();
      this.nextAt += this.stepMs;
      steps++;
      try {
        this.step(this.stepMs / 1000);
      } catch (err) {
        console.error('[party-game] game loop step failed', err);
      }
      const took = performance.now() - t0;
      const s = this.s;
      s.ticks++;
      s.stepSum += took;
      if (took > s.stepMax) s.stepMax = took;
      s.lagSum += lag;
      if (lag > s.lagMax) s.lagMax = lag;
      now = performance.now();
    }
    if (this.nextAt <= now) {
      // fell too far behind: drop the backlog rather than spiral
      this.s.overruns++;
      this.nextAt = now + this.stepMs;
    }
  }
}
