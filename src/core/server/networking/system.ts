import { readFileSync } from 'node:fs';
import os from 'node:os';

const MB = 1048576;
const round1 = (n: number) => Math.round(n * 10) / 10;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

let prev = cpuTimes();

function temperatureC(): number | null {
  try {
    const raw = readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    const v = Number.parseInt(raw, 10);
    return Number.isFinite(v) ? round1(v / 1000) : null;
  } catch {
    return null;
  }
}

/** Host-level metrics. CPU % is measured between consecutive calls. */
export function sampleSystem() {
  const cur = cpuTimes();
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  prev = cur;
  const cpuPercent = dTotal > 0 ? Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100)) : 0;
  const total = os.totalmem();
  const free = os.freemem();
  return {
    cpuPercent: round1(cpuPercent),
    cpuCount: os.cpus().length,
    loadavg: os.loadavg().map(round1),
    memTotalMB: round1(total / MB),
    memUsedMB: round1((total - free) / MB),
    hostUptimeSec: Math.round(os.uptime()),
    processUptimeSec: Math.round(process.uptime()),
    temperatureC: temperatureC(),
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
  };
}
