import type { GameAi as GamePlugin } from '../../../core/shared/ai';

const byKind = new Map<string, GamePlugin>();

export function registerGame(plugin: GamePlugin): void {
  byKind.set(plugin.kind, plugin);
}

export const pluginForKind = (kind: string): GamePlugin | undefined => byKind.get(kind);
export const pluginForId = (id: string): GamePlugin | undefined => [...byKind.values()].find((p) => p.id === id);
export const registeredGames = (): GamePlugin[] => [...byKind.values()];
