/**
 * Companion server: runs the AI bots for a party-game server.
 * It watches the server's open rooms and, where an AI exists for the game (the AI router decides), sends a bot
 * into the lobby. A dashboard shows the bots and the resources used.
 *
 *   npm run bot:server -- --server http://localhost:8080
 *   ADMIN_TOKEN=secret npm run bot:server -- -c bot/server/config.example.yaml
 *   npm run bot:server -- --check          (validate and show every effective value)
 */
import { AiRouter } from '../router/router';
import { AuditLog } from './audit';
import { loadConfig } from './config';
import { checkConfig } from './check';
import { ConfigError, USAGE, parseArgs, validateConfig } from './settings';
import { RuntimeConfig } from './runtimeConfig';
import { createApi } from './http';
import { BotManager } from './manager';
import { MetricsSampler, mainServerProbe } from './metrics';
import { WorkerRunner } from './runner';
import { RoomWatcher } from './watcher';
import '../games';
import { loadPackAis } from '../games/packs';

const argv = process.argv.slice(2);
const stamp = () => new Date().toISOString().slice(11, 19);

let loaded: ReturnType<typeof loadConfig>;
try {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  loaded = loadConfig(argv);
  if (args.check) process.exit(checkConfig(loaded));
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[bots] ${err.message}`);
    process.exit(err.exitCode);
  }
  throw err;
}
const cfg = loaded.cfg;
// games installed as packs bring their own AI: BOT_GAMES_DIR lists folders of packs (path-separated), like the game server's dist/games
if (process.env.BOT_GAMES_DIR) await loadPackAis(process.env.BOT_GAMES_DIR.split(':').filter(Boolean), (l) => console.log(`[${stamp()}] ${l}`));
for (const w of loaded.warnings) console.warn(`[bots] ${w}`);
const errors = validateConfig(cfg);
if (errors.length) {
  console.error(errors.map((e) => `[bots] config: ${e}`).join('\n'));
  process.exit(1);
}
console.log(`[bots] config: ${loaded.file ? `${loaded.file.path} (${loaded.file.source})` : 'environment only'}`);

const router = new AiRouter(cfg.ai);
const bots = new BotManager(new WorkerRunner(), cfg);
const metrics = new MetricsSampler(bots, mainServerProbe(cfg.gameServer.url, cfg.gameServer.adminToken));
const watcher = new RoomWatcher(cfg, router, bots);
const audit = new AuditLog(cfg.server.dataDir);
const runtime = new RuntimeConfig(
  cfg,
  cfg.server.dataDir,
  () => router.catalog().map((g) => ({ id: g.id, levels: g.levels, policies: g.policies })),
  () => watcher.reschedule(),
);
bots.onEnded = (row, error) => {
  console.log(`[${stamp()}] ${row.name} left room ${row.room}: ${row.endReason || error || 'ended'}`);
  // a bot the room's settings sent away (filling off, level changed, seat removed, a human took the seat) is no failure
  const settled = ['no humans left', 'room closed', 'host'].includes(row.endReason) || (row.hosted && ['KICKED', 'level changed'].includes(row.endReason));
  if (!settled) watcher.coolOff(row.room);
};

const api = createApi({ cfg, router, bots, metrics, watcher, runtime, audit, startedAt: Date.now() });
api.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[bots] cannot listen on ${cfg.server.host}:${cfg.server.port}: ${err.message}`);
  process.exit(1);
});
api.listen(cfg.server.port, cfg.server.host, () => {
  const a = api.address();
  const port = typeof a === 'object' && a ? a.port : cfg.server.port;
  console.log(`[${stamp()}] companion server for ${cfg.gameServer.url}`);
  console.log(`[${stamp()}] AI available: ${router.catalog().map((g) => `${g.id} (${g.levels.join('/')})`).join(', ') || 'none'}`);
  console.log(`[${stamp()}] dashboard http://${cfg.server.host}:${port}/  (${cfg.server.adminToken ? 'admin token required' : 'local access only'})${cfg.metrics.enabled ? ', Prometheus at /metrics' : ''}`);
});
metrics.start();
watcher.start();

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  console.log(`[${stamp()}] shutting down`);
  watcher.stop();
  metrics.stop();
  bots.stopAll('companion shutting down');
  api.close();
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
