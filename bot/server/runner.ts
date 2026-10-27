// How a bot is run. The companion server uses worker threads (one per bot, so each bot has its own V8 isolate and
// event loop to measure). The interface is deliberately small: the main server could later implement it in-process
// (same router, no sockets) or a game pack could provide its own.
import { Worker } from 'node:worker_threads';
import type { BotEvent } from '../../src/plugins/bots/engine/brain';
import type { BotHandle, BotRunner, BotSpec, BotUsage, RunnerHooks } from '../../src/plugins/bots/engine/types';

export type { BotHandle, BotRunner, BotSpec, BotUsage, RunnerHooks };

const fromSource = import.meta.url.endsWith('.ts');
const workerFile = (): URL => new URL(fromSource ? './worker.ts' : './bot-worker.js', import.meta.url);

// From source (tsx) the worker is a .ts file, and Node 20 neither carries the main thread's tsx loader into worker threads
// nor honours --import in their execArgv: the worker starts from a one-line script that registers tsx first.
const startWorker = (spec: BotSpec): Worker => {
  const resourceLimits = { maxOldGenerationSizeMb: 96 };
  if (!fromSource) return new Worker(workerFile(), { workerData: spec, resourceLimits });
  const boot = `import('tsx/esm/api').then((t) => { t.register(); return import(${JSON.stringify(workerFile().href)}); })`;
  return new Worker(boot, { eval: true, workerData: spec, resourceLimits });
};

export class WorkerRunner implements BotRunner {
  start(spec: BotSpec, hooks: RunnerHooks): BotHandle {
    const w = startWorker(spec);
    let heapMB = 0;
    let externalMB = 0;
    let lastElu = w.performance.eventLoopUtilization();
    let lastAt = Date.now();
    let cpu = 0;
    let error: string | undefined;
    w.on('message', (m: { t: string; e?: BotEvent; line?: string; heapMB?: number; externalMB?: number; error?: string }) => {
      if (m.t === 'event' && m.e) hooks.onEvent(m.e);
      else if (m.t === 'log' && m.line) hooks.onLog(m.line);
      else if (m.t === 'mem') {
        heapMB = m.heapMB ?? 0;
        externalMB = m.externalMB ?? 0;
      } else if (m.t === 'done') error = m.error;
    });
    w.on('error', (e) => (error = e.message));
    w.on('exit', () => hooks.onExit(error));
    return {
      stop: (reason) => w.postMessage({ t: 'stop', reason }),
      usage: () => {
        const now = Date.now();
        if (now - lastAt >= 500) {
          const d = w.performance.eventLoopUtilization(lastElu);
          lastElu = w.performance.eventLoopUtilization();
          lastAt = now;
          cpu = Math.round(d.utilization * 1000) / 10;
        }
        return { cpu, heapMB, externalMB };
      },
    };
  }
}
