import os from 'node:os';

export interface MetricPoint {
  ts: number;
  /** this process, % of one core over the sample interval */
  procCpu: number;
  /** host memory in use, % */
  memPct: number;
  rssMB: number;
  load1: number;
  rooms: number;
  clients: number;
  /** tick overruns during the interval */
  overruns: number;
  avgStepMs: number;
}

export interface SamplerSource {
  rooms(): number;
  clients(): number;
  loop(): { overruns: number; avgStepMs: number };
}

/** Fixed-size ring of recent samples; the dashboard draws its charts from it. */
export class MetricsSampler {
  private points: MetricPoint[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastCpu = process.cpuUsage();
  private lastAt = Date.now();
  private lastOverruns = 0;

  constructor(
    private readonly source: SamplerSource,
    readonly intervalMs = 5000,
    private readonly capacity = 120,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sample(now = Date.now()): MetricPoint {
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsed = Math.max(1, now - this.lastAt);
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;
    const loop = this.source.loop();
    // the loop counters are cumulative since the last stats reset; a reset shows as a drop
    const overruns = loop.overruns >= this.lastOverruns ? loop.overruns - this.lastOverruns : loop.overruns;
    this.lastOverruns = loop.overruns;
    const total = os.totalmem();
    const p: MetricPoint = {
      ts: now,
      procCpu: Math.round(((cpu.user + cpu.system) / 1000 / elapsed) * 1000) / 10,
      memPct: Math.round(((total - os.freemem()) / total) * 1000) / 10,
      rssMB: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
      load1: Math.round(os.loadavg()[0]! * 100) / 100,
      rooms: this.source.rooms(),
      clients: this.source.clients(),
      overruns,
      avgStepMs: Math.round(loop.avgStepMs * 100) / 100,
    };
    this.points.push(p);
    if (this.points.length > this.capacity) this.points.shift();
    return p;
  }

  list(): MetricPoint[] {
    return [...this.points];
  }
}
