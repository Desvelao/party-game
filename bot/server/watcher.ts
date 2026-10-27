// The bot server's room watcher: the shared engine's watcher, wired to the game server over HTTP (rooms) and a spectator socket (probe).
import { RoomWatcher as EngineWatcher, type WatcherDeps } from '../../src/plugins/bots/engine/watcher';
import type { AiRouter } from '../../src/plugins/bots/engine/router';
import type { BotManager } from '../../src/plugins/bots/engine/manager';
import type { CompanionConfig } from './settings';
import { probeRoom } from './probe';

export * from '../../src/plugins/bots/engine/watcher';

/** /rooms?format=json of the game server and a spectator socket to read what a room plays. */
export const httpDeps: WatcherDeps = {
  async fetchRooms(base) {
    const res = await fetch(base.replace(/\/+$/, '') + '/rooms?format=json', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`/rooms ${res.status}`);
    return (await res.json()) as Awaited<ReturnType<WatcherDeps['fetchRooms']>>;
  },
  probe: (url, code) => probeRoom(url, code),
  now: () => Date.now(),
};

export class RoomWatcher extends EngineWatcher {
  constructor(cfg: CompanionConfig, router: AiRouter, bots: BotManager, deps: WatcherDeps = httpDeps) {
    super(cfg, router, bots, deps);
  }
}
