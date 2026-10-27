// Worker thread: one bot (a BotClient) per thread, reporting events and its own heap to the companion server.
import v8 from 'node:v8';
import { parentPort, workerData } from 'node:worker_threads';
import { isBotLevel } from '../../src/plugins/bots/engine/levels';
import { BotClient } from '../core/client';
import '../games';
import { loadPackAis } from '../games/packs';
import type { BotSpec } from './runner';

// the AIs of installed game packs (BOT_GAMES_DIR, like main.ts): a bare bot has no built-in AI at all
if (process.env.BOT_GAMES_DIR) await loadPackAis(process.env.BOT_GAMES_DIR.split(':').filter(Boolean));

const spec = workerData as BotSpec;
const port = parentPort!;

const client = new BotClient({
  url: spec.url,
  name: spec.name,
  code: spec.room,
  minPlayers: 2,
  startDelayMs: 3000,
  resultsDelayMs: 3000,
  matches: 0,
  reportsDir: spec.reports.dir,
  reports: spec.reports.enabled,
  passive: true,
  ...(spec.auth ? { plugin: { id: 'bots', token: spec.auth.token, data: { level: isBotLevel(spec.plan.level) ? spec.plan.level : 'normal', ...(spec.auth.seat ? { seat: spec.auth.seat } : {}) } } } : {}),
  policy: spec.plan.policy,
  level: spec.plan.level || undefined,
  scenario: 'companion',
  seat: spec.name,
  params: spec.plan.params,
  seed: spec.seed,
  log: (line) => port.postMessage({ t: 'log', line }),
  onEvent: (e) => port.postMessage({ t: 'event', e }),
});

const mem = setInterval(() => {
  const h = v8.getHeapStatistics();
  port.postMessage({ t: 'mem', heapMB: Math.round((h.used_heap_size / 1048576) * 10) / 10, externalMB: Math.round((h.external_memory / 1048576) * 10) / 10 });
}, 2000);

port.on('message', (m: { t: string; reason?: string }) => {
  if (m.t === 'stop') client.stop(m.reason ?? 'stopped');
});
// a listener on the parent port would keep the thread alive after the bot has left
port.unref();

client.run().then(
  () => port.postMessage({ t: 'done' }),
  (e: Error) => port.postMessage({ t: 'done', error: e.message }),
).finally(() => clearInterval(mem));
