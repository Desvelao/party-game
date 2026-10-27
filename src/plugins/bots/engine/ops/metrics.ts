// Resource usage over time: this host, the party-game server, this companion process, the bots as a group and each bot.
import os from 'node:os';
import type { BotManager } from '../manager';

export interface MainServerUsage {
  reachable: boolean;
  /** process CPU of the game server, % of one core (average since its last stats reset unless an admin token is set) */
  cpu: number;
  rssMB: number;
  heapMB: number;
  rooms: number;
  maxRooms: number;
  clients: number;
  /** host figures of the game server's machine (needs its admin token) */
  host: { cpuPercent: number; memUsedMB: number; memTotalMB: number; cpuCount: number; temperatureC: number | null } | null;
  instant: boolean;
  version: string;
}

export interface MetricPoint {
  ts: number;
  host: { cpu: number; memPct: number; memUsedMB: number; memTotalMB: number; load1: number; cores: number };
  /** this companion process (manager, dashboard and all bot threads) */
  companion: { cpu: number; rssMB: number; heapMB: number };
  /** the bot threads together */
  bots: { count: number; cpu: number; heapMB: number };
  /** the companion's own share: process minus bots */
  core: { cpu: number };
  main: MainServerUsage | null;
  perBot: Record<string, { cpu: number; heapMB: number }>;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export class MetricsSampler {
  private points: MetricPoint[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastCpu = process.cpuUsage();
  private lastAt = Date.now();
  private lastTimes = os.cpus().map((c) => c.times);
  main: MainServerUsage | null = null;

  constructor(
    private readonly bots: BotManager,
    private readonly fetchMain: () => Promise<MainServerUsage | null>,
    readonly intervalMs = 3000,
    private readonly capacity = 200,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.fetchMain().then((m) => (this.main = m), () => (this.main = null));
      this.sample();
    }, this.intervalMs);
    this.timer.unref();
    void this.fetchMain().then((m) => (this.main = m), () => {});
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private hostCpu(): number {
    const now = os.cpus().map((c) => c.times);
    let busy = 0;
    let total = 0;
    now.forEach((t, i) => {
      const p = this.lastTimes[i] ?? t;
      const d = { user: t.user - p.user, nice: t.nice - p.nice, sys: t.sys - p.sys, idle: t.idle - p.idle, irq: t.irq - p.irq };
      const sum = d.user + d.nice + d.sys + d.idle + d.irq;
      total += sum;
      busy += sum - d.idle;
    });
    this.lastTimes = now;
    return total > 0 ? r1((busy / total) * 100) : 0;
  }

  sample(now = Date.now()): MetricPoint {
    this.bots.sampleUsage();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsed = Math.max(1, now - this.lastAt);
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;
    const procCpu = r1(((cpu.user + cpu.system) / 1000 / elapsed) * 100);
    const mem = process.memoryUsage();
    const total = os.totalmem();
    const perBot: MetricPoint['perBot'] = {};
    let botCpu = 0;
    let botHeap = 0;
    const active = this.bots.active();
    for (const r of active) {
      perBot[r.id] = { cpu: r.cpu, heapMB: r1(r.heapMB + r.externalMB) };
      botCpu += r.cpu;
      botHeap += r.heapMB + r.externalMB;
    }
    const p: MetricPoint = {
      ts: now,
      host: { cpu: this.hostCpu(), memPct: r1(((total - os.freemem()) / total) * 100), memUsedMB: Math.round((total - os.freemem()) / 1048576), memTotalMB: Math.round(total / 1048576), load1: Math.round(os.loadavg()[0] * 100) / 100, cores: os.cpus().length },
      companion: { cpu: procCpu, rssMB: r1(mem.rss / 1048576), heapMB: r1(mem.heapUsed / 1048576) },
      bots: { count: active.length, cpu: r1(botCpu), heapMB: r1(botHeap) },
      core: { cpu: Math.max(0, r1(procCpu - botCpu)) },
      main: this.main,
      perBot,
    };
    this.points.push(p);
    if (this.points.length > this.capacity) this.points.shift();
    return p;
  }

  latest(): MetricPoint | null {
    return this.points[this.points.length - 1] ?? null;
  }

  list(): MetricPoint[] {
    return [...this.points];
  }
}

/** Reads the game server's own figures: /stats (public) and, with its admin token, /api/admin/status + metrics. */
export function mainServerProbe(base: string, adminToken: string): () => Promise<MainServerUsage | null> {
  const root = base.replace(/\/+$/, '');
  const get = async (path: string, auth: boolean): Promise<any> => {
    const res = await fetch(root + path, { signal: AbortSignal.timeout(2500), headers: auth && adminToken ? { Authorization: `Bearer ${adminToken}` } : {} });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  };
  return async () => {
    try {
      const s = await get('/stats', false);
      const out: MainServerUsage = { reachable: true, cpu: s.cpuPercent, rssMB: s.rssMB, heapMB: s.heapMB, rooms: s.rooms, maxRooms: s.maxRooms, clients: s.clients, host: null, instant: false, version: '' };
      if (adminToken) {
        try {
          const [st, m] = await Promise.all([get('/api/admin/status', true), get('/api/admin/metrics', true)]);
          const sys = st.system;
          out.host = { cpuPercent: sys.cpuPercent, memUsedMB: sys.memUsedMB, memTotalMB: sys.memTotalMB, cpuCount: sys.cpuCount, temperatureC: sys.temperatureC ?? null };
          const last = m.points?.[m.points.length - 1];
          if (last) {
            out.cpu = last.procCpu;
            out.instant = true;
          }
          out.version = st.version ?? '';
        } catch {
          /* token wrong or admin API off: keep the public numbers */
        }
      }
      return out;
    } catch {
      return { reachable: false, cpu: 0, rssMB: 0, heapMB: 0, rooms: 0, maxRooms: 0, clients: 0, host: null, instant: false, version: '' };
    }
  };
}
