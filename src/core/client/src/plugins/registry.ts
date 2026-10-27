/**
 * Installed game packs on the client: the list (with catalog and translations) is fetched once at
 * boot, before the app starts, so menus and validation know the games; a pack's code
 * (`client.mjs`) is imported lazily when its game is about to be played.
 */
import {
  characterModel,
  gameIdOf,
  loc,
  registerCharacterModels,
  registerGames,
  registerTranslations,
  shakeScale,
  t,
  tr,
  variantName,
  type CatalogGame,
  type CharacterModelDef,
  type PackLocales,
} from '../../../shared';
import { prefersReducedMotion } from '../motion';
import { sfx } from '../audio/sfx';
import { TRACKS } from '../audio/music';
import { drawCharacter } from '../scenes/character';
import { registerDraws } from './characters';
import { session } from '../session';
import type { ClientContext, ClientGamePlugin } from './api';

interface PackInfo {
  digest: string;
  /** the character model its players are drawn with */
  character?: string;
  loading?: Promise<void>;
}

const packs = new Map<string, PackInfo>();
const byKind = new Map<string, ClientGamePlugin>();
let bigSink: (text: string) => void = () => {};

/** The scene registers how to flash a big message. */
export function setBigTextSink(fn: (text: string) => void): void {
  bigSink = fn;
}

let actionSink: (data: Record<string, unknown>) => void = () => {};

/** The app registers how a pack's messages reach the server. */
export function setActionSink(fn: (data: Record<string, unknown>) => void): void {
  actionSink = fn;
}

export const context: ClientContext = {
  t,
  tr,
  loc,
  variantName,
  myId: () => session.myId,
  colorOf: (id) => session.colorOf(id),
  labelOf: (id) => session.labelOf(id),
  drawCharacter: (g, id, x, y, r, facing) => {
    const model = characterModel(characterOf(session.playingId));
    drawCharacter(g, model?.id, model ? session.lookOf(id, model) : {}, session.colorOf(id), x, y, r, facing, id === session.myId);
  },
  motion: () => shakeScale(session.access.motion, prefersReducedMotion()),
  lerp: (a, b, k) => a + (b - a) * k,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  sfx: (name) => sfx.play(name),
  sound: (steps) => sfx.recipe(steps),
  big: (text) => bigSink(text),
  send: (data) => actionSink(data),
};

interface IndexEntry {
  id: string;
  digest: string;
  catalog: CatalogGame;
  locales?: PackLocales;
  character?: string;
  characters?: CharacterModelDef[];
}

/**
 * Fetch the installed games and register them. Never rejects: with no list (old server, offline)
 * the app simply starts with the games it already knows.
 */
export async function bootGames(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetcher('/games/index.json', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { games?: IndexEntry[] };
    for (const g of body.games ?? []) {
      try {
        registerGames([g.catalog]);
        registerTranslations(g.locales);
        registerCharacterModels({ kind: 'game', id: g.id }, g.characters);
        packs.set(g.id, { digest: g.digest, character: g.character });
      } catch (err) {
        console.warn(`[party-game] ignoring game ${g.id}`, err);
      }
    }
  } catch {
    /* no games list: continue with what is built in */
  }
}

const isPlugin = (v: unknown): v is ClientGamePlugin =>
  typeof v === 'object' && v !== null && Array.isArray((v as ClientGamePlugin).kinds) && typeof (v as ClientGamePlugin).createRenderer === 'function';

/** Import the code of the pack that owns `playableId` (a no-op for built-in games and once loaded). */
export function loadPlugin(playableId: string): Promise<void> {
  const id = gameIdOf(playableId) || playableId;
  const pack = packs.get(id);
  if (!pack) return Promise.resolve();
  pack.loading ??= (async () => {
    const mod = (await import(/* @vite-ignore */ `/games/${id}/client.mjs?v=${pack.digest}`)) as { default?: unknown };
    if (!isPlugin(mod.default)) throw new Error(`game ${id}: client.mjs must export default { kinds, createRenderer }`);
    for (const kind of mod.default.kinds) byKind.set(kind, mod.default);
    registerDraws({ kind: 'game', id }, mod.default.characters);
    if (mod.default.music) TRACKS[id] = mod.default.music;
  })().catch((err) => {
    console.error(`[party-game] could not load game ${id}`, err);
    pack.loading = undefined;
    throw err;
  });
  return pack.loading;
}

/** The character model a game (or one of its variants) draws its players with, if any. */
export const characterOf = (playableId: string): string | undefined => packs.get(gameIdOf(playableId) || playableId)?.character;

export const pluginForKind = (kind: string): ClientGamePlugin | undefined => byKind.get(kind);

/** For tests. */
export function resetPlugins(): void {
  packs.clear();
  byKind.clear();
}
