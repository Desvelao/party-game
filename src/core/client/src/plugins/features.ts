/**
 * Installed plugins on the client (see docs/development/plugins.md). The list is fetched at boot, before the
 * app starts, so their translations are known; a plugin's interface (`client.mjs`) is imported once, then the
 * lobby asks each plugin for the pieces it draws (the slots below). A plugin that fails to load is skipped.
 */
import { registerCharacterModels, registerTranslations, t, tr, type CharacterDraw, type CharacterModelDef, type Looks, type PackLocales, type PlayerInfo, type RoomPhase } from '../../../shared';
import { setRecoveryResolver } from '../profile';
import { qrSvg } from '../qr';
import { session } from '../session';
import { h } from '../ui/dom';
import { registerDraws } from './characters';

/** What a plugin's interface can use of the app. */
export interface FeatureContext {
  t: typeof t;
  tr: typeof tr;
  /** tiny DOM builder: `h('button', { class: 'btn small', onClick }, 'Text')` */
  h: typeof h;
  /** this plugin's state for the room (what its server half keeps with `room.setExt`) */
  state<T = unknown>(): T | undefined;
  /** what the plugin's server half shows next to a player (`PlayerInfo.ext`) */
  playerState<T = unknown>(playerId: string): T | undefined;
  players(): PlayerInfo[];
  myId(): string;
  isHost(): boolean;
  phase(): RoomPhase;
  maxPlayers(): number;
  /** send a small JSON object to the plugin's server half (`onAction`) */
  send(data: Record<string, unknown>): void;
}

/** What a plugin's profile section can use, besides the usual context. */
export interface ProfileContext extends FeatureContext {
  /** this player's profile key (a secret: it never leaves the device except to the plugin's own server half) */
  profileKey: string;
  /** copy `text` to the clipboard (or offer it to copy), then show `done` */
  copy(text: string, done: string): Promise<void>;
  toast(text: string): void;
  /** a QR code for `text`, or null when it is too long */
  qr(text: string, px?: number): SVGSVGElement | null;
  /** the game families of the catalog */
  games(): { id: string; name: string }[];
}

/** What a plugin's own screen can use, besides the usual context. */
export interface ScreenContext extends FeatureContext {
  /** a player's avatar (their chosen character model, with their look of it and their colour) on a canvas of `size` px */
  avatar(player: { looks?: Looks; avatar?: string }, color: number, size: number): HTMLCanvasElement;
  /** the game families of the catalog, for filters */
  games(): { id: string; name: string }[];
  /** the pill that shows how many players are online */
  presence(): HTMLElement;
  /** go back to the main menu */
  back(): void;
}

/** A page of the app that a plugin draws, with its button in the top navigation. */
export interface PluginScreenDef {
  /** where it lives, like `/leaderboard` (also listed in the manifest's `clientRoutes` so the server serves the app there) */
  path: string;
  /** text of its navigation button (English, translated with the manifest's `locales`) */
  navLabel: string;
  /** the screen: a `<div class="panel">` the app puts on the page */
  render(ctx: ScreenContext): HTMLElement;
}

/** The pieces of the app a plugin may draw. Return null to draw nothing. */
export interface ClientPlugin {
  /** controls inside the host's "Room controls" panel (only the host sees the panel) */
  lobbyHost?(ctx: FeatureContext): HTMLElement | null;
  /** a line under the room's player count, for everyone */
  lobbyInfo?(ctx: FeatureContext): HTMLElement | null;
  /** next to one player: a tag replaces the ready tag, `actions` follow the name (host buttons) */
  lobbyRow?(player: PlayerInfo, ctx: FeatureContext): { tag?: string; actions?: HTMLElement } | null;
  /** extra rows after the players (seats held for something that has not joined yet) */
  lobbyRows?(ctx: FeatureContext): HTMLElement[];
  /** a page of its own with a button in the top navigation */
  screen?: PluginScreenDef;
  /** a block at the end of the profile's Info tab (moving a profile to another device) */
  profileSection?(ctx: ProfileContext): HTMLElement | null;
  /**
   * Another way to adopt a profile on this device. `hash` names the link fragment it handles (`#<hash>=...`);
   * `resolve` turns what was pasted or opened into a profile key, or null when it is not for this plugin or has expired.
   */
  recoveryInput?: { hash: string; resolve(raw: string): Promise<string | null> };
  /** how the character models this plugin declares in `characters` of plugin.json are drawn, by model id */
  characters?: Record<string, CharacterDraw>;
}

interface Entry {
  id: string;
  digest: string;
  plugin?: ClientPlugin;
}

const entries: Entry[] = [];
let sender: (plugin: string, data: Record<string, unknown>) => void = () => {};

/** The app registers how a plugin's messages reach the server. */
export function setPluginSink(fn: (plugin: string, data: Record<string, unknown>) => void): void {
  sender = fn;
}

function contextFor(id: string): FeatureContext {
  return {
    t,
    tr,
    h,
    state: <T>() => session.ext[id] as T | undefined,
    playerState: <T>(playerId: string) => session.players.find((p) => p.id === playerId)?.ext?.[id] as T | undefined,
    players: () => session.players,
    myId: () => session.myId,
    isHost: () => session.isHost && !session.spectator,
    phase: () => session.phase,
    maxPlayers: () => session.maxPlayers,
    send: (data) => sender(id, data),
  };
}

const isClientPlugin = (v: unknown): v is ClientPlugin => typeof v === 'object' && v !== null;

/**
 * Fetch the installed plugins and import the interface of those that have one. Never rejects: with no list
 * (old server, offline) the app simply starts without plugins.
 */
export async function bootFeatures(
  fetcher: typeof fetch = fetch,
  load: (url: string) => Promise<{ default?: unknown }> = (url) => import(/* @vite-ignore */ url),
): Promise<void> {
  try {
    const res = await fetcher('/plugins/index.json', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { plugins?: { id: string; digest: string; client: boolean; locales?: PackLocales; characters?: CharacterModelDef[] }[] };
    const loaded = await Promise.all(
      (body.plugins ?? []).map(async (p) => {
        try {
          registerTranslations(p.locales);
          // in list order (not import order), so the first model is the same on every device
          registerCharacterModels({ kind: 'plugin', id: p.id }, p.characters);
          if (!p.client) return null;
          const mod = await load(`/plugins/${p.id}/client.mjs?v=${p.digest}`);
          if (!isClientPlugin(mod.default)) throw new Error('client.mjs must export default { ... }');
          registerDraws({ kind: 'plugin', id: p.id }, mod.default.characters);
          return { id: p.id, digest: p.digest, plugin: mod.default };
        } catch (err) {
          console.warn(`[party-game] could not load the interface of plugin ${p.id}`, err);
          return null;
        }
      }),
    );
    // in list order (not import-completion order), so slots and first-wins tags are the same on every device
    for (const e of loaded) if (e) entries.push(e);
  } catch {
    /* no plugin list: continue without plugins */
  }
}

function each<T>(fn: (plugin: ClientPlugin, ctx: FeatureContext) => T | null | undefined): T[] {
  const out: T[] = [];
  for (const e of entries) {
    try {
      const v = fn(e.plugin!, contextFor(e.id));
      if (v !== null && v !== undefined) out.push(v);
    } catch (err) {
      console.warn(`[party-game] plugin ${e.id} failed while drawing`, err);
    }
  }
  return out;
}

/** Pieces for the host's room controls. */
export const lobbyHostSlots = (): HTMLElement[] => each((p, c) => p.lobbyHost?.(c));
/** Lines for everyone under the player count. */
export const lobbyInfoSlots = (): HTMLElement[] => each((p, c) => p.lobbyInfo?.(c));
/** Extra rows after the players. */
export const lobbyExtraRows = (): HTMLElement[] => each((p, c) => p.lobbyRows?.(c)).flat();
/** What plugins add to one player's row (the first tag wins; every actions element is kept). */
export function lobbyRowSlots(player: PlayerInfo): { tag?: string; actions: HTMLElement[] } {
  const parts = each((p, c) => p.lobbyRow?.(player, c));
  return { tag: parts.find((x) => x.tag)?.tag, actions: parts.flatMap((x) => (x.actions ? [x.actions] : [])) };
}

/** Pieces for the end of the profile's Info tab. */
export function profileSectionSlots(key: string, toast: (text: string) => void, games: () => { id: string; name: string }[]): HTMLElement[] {
  const copy = async (text: string, done: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      window.prompt(t('toast.copyPrompt'), text);
    }
  };
  return each((p, c) => p.profileSection?.({ ...c, profileKey: key, copy, toast, qr: qrSvg, games }));
}

/** The screens plugins draw, with their navigation text already translated. */
export const pluginScreens = (): { id: string; path: string; navLabel: string }[] =>
  entries.flatMap((e) => (e.plugin?.screen ? [{ id: e.id, path: e.plugin.screen.path, navLabel: tr(e.plugin.screen.navLabel) }] : []));

/** The plugin screen that lives at `pathname`, if any. */
export const pluginScreenAt = (pathname: string): { id: string; path: string; navLabel: string } | undefined => {
  const path = pathname.replace(/\/$/, '');
  return pluginScreens().find((s) => s.path === path);
};

/** Draw a plugin's screen; null when the plugin has none or fails (it is logged). */
export function renderPluginScreen(id: string, extra: Omit<ScreenContext, keyof FeatureContext>): HTMLElement | null {
  const e = entries.find((x) => x.id === id);
  if (!e?.plugin?.screen) return null;
  try {
    return e.plugin.screen.render({ ...contextFor(id), ...extra });
  } catch (err) {
    console.warn(`[party-game] plugin ${id} failed while drawing its screen`, err);
    return null;
  }
}

/** Link fragments (`#<name>=`) that carry a profile: the core's own and the plugins'. */
export const recoveryHashes = (): string[] => ['recover', ...entries.flatMap((e) => (e.plugin?.recoveryInput ? [e.plugin.recoveryInput.hash] : []))];

setRecoveryResolver(async (raw) => {
  for (const e of entries) {
    const r = e.plugin?.recoveryInput;
    if (!r) continue;
    try {
      const key = await r.resolve(raw);
      if (key) return key;
    } catch (err) {
      console.warn(`[party-game] plugin ${e.id} failed while reading a profile code`, err);
    }
  }
  return null;
});

/** For tests. */
export function resetFeatures(): void {
  entries.length = 0;
}
export function addFeatureForTest(id: string, plugin: ClientPlugin): void {
  entries.push({ id, digest: '', plugin });
}
