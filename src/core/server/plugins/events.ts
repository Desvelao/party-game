import type { PluginEventMap } from '../../shared';

type Listeners = { [E in keyof PluginEventMap]: Set<(payload: PluginEventMap[E]) => void> };

/** The server's event bus for plugins (`host.events`). A throwing listener is logged and never reaches the caller. */
export class ServerEvents {
  private listeners: Listeners = { matchFinished: new Set(), resultRecorded: new Set(), profileChanged: new Set() };

  /** Listen to an event; returns the function that stops listening. */
  on<E extends keyof PluginEventMap>(event: E, fn: (payload: PluginEventMap[E]) => void): () => void {
    this.listeners[event].add(fn);
    return () => void this.listeners[event].delete(fn);
  }

  /** `make` builds the payload only when somebody listens, so an unused bus costs nothing on the hot path. */
  emit<E extends keyof PluginEventMap>(event: E, make: () => PluginEventMap[E]): void {
    const set = this.listeners[event];
    if (set.size === 0) return;
    const payload = make();
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[party-game] ${event} listener failed`, err);
      }
    }
  }
}
