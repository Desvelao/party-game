/**
 * Boot-time discovery and start of installed plugins (see docs/development/plugins.md). Like game packs, two
 * directories are scanned (plugins baked into the build, and plugins the operator installed); the higher version
 * wins and a tie goes to the operator's copy. A plugin that fails verification or loading is logged and skipped:
 * it must never stop the server. Plugins start after the games are registered and the rooms exist, in the order
 * their `requires` ask for, and stop when the server does.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CORE_VERSION,
  PLUGIN_API_VERSION,
  compareVersions,
  satisfies,
  type PluginConfigValue,
  type PluginHost,
  type PluginHttpRequest,
  type PluginHttpResponse,
  type PluginManifest,
  type PluginOption,
  type PluginRoom,
  type ServerPlugin,
  type VirtualPlayerRoom,
  type VirtualSeat,
} from '../../shared';
import { characterModels, playableIdsOf, registerCharacterModels, registerTranslations, unregisterCharacterModels } from '../../shared';
import { ConfigError } from '../configFile';
import { registeredAis } from '../minigames';
import type { ServerEvents } from './events';
import { PackError, loadPluginPack } from './pack';

export type PluginSource = 'bundled' | 'installed';

export interface InstalledPlugin {
  manifest: PluginManifest;
  source: PluginSource;
  dir: string;
  /** identifies this exact plugin; clients use it to bust their cache */
  digest: string;
}

export interface PluginDirs {
  bundled: string | null;
  installed: string | null;
}

/** Where the operator's plugins live: `plugins.dir`, else `plugins` inside the data directory. */
export function installedPluginsDir(cfg: { pluginsDir: string; dataDir: string }): string {
  return resolve(cfg.pluginsDir || join(cfg.dataDir, 'plugins'));
}

export interface PluginScan {
  plugins: InstalledPlugin[];
  skipped: { dir: string; reason: string }[];
}

const byOrder = (a: InstalledPlugin, b: InstalledPlugin): number => (a.manifest.order ?? 1000) - (b.manifest.order ?? 1000) || a.manifest.id.localeCompare(b.manifest.id);

/** Find every usable plugin pack. Runs no plugin code. */
export function scanPlugins(dirs: PluginDirs): PluginScan {
  const found = new Map<string, InstalledPlugin>();
  const skipped: { dir: string; reason: string }[] = [];
  const scan = (root: string | null, source: PluginSource): void => {
    if (!root || !existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = join(root, entry.name);
      try {
        const pack = loadPluginPack(dir);
        if (pack.manifest.id !== entry.name) throw new PackError(`the folder is called "${entry.name}" but the plugin id is "${pack.manifest.id}"`);
        const prev = found.get(pack.manifest.id);
        if (prev && compareVersions(pack.manifest.version, prev.manifest.version) < 0) continue;
        found.set(pack.manifest.id, { manifest: pack.manifest, source, dir, digest: pack.digest });
      } catch (err) {
        skipped.push({ dir, reason: (err as Error).message });
      }
    }
  };
  scan(dirs.bundled, 'bundled');
  scan(dirs.installed, 'installed');
  return { plugins: [...found.values()].sort(byOrder), skipped };
}

/** Which ids a `plugins.enabled` / PLUGINS value allows: `all`, `none` or a comma separated list. */
export function enabledFilter(spec: string): (id: string) => boolean {
  const v = spec.trim().toLowerCase();
  if (v === '' || v === 'all') return () => true;
  if (v === 'none') return () => false;
  const ids = new Set(v.split(',').map((x) => x.trim()).filter(Boolean));
  return (id) => ids.has(id);
}

function coerce(o: PluginOption, raw: unknown, where: string, strict: boolean): PluginConfigValue | undefined {
  const bad = (why: string): undefined => {
    if (strict) throw new ConfigError(`${where}: ${why}`);
    console.warn(`[party-game] ${where}: ${why}; using the default`);
    return undefined;
  };
  switch (o.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (!strict && typeof raw === 'string') {
        const v = raw.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(v)) return true;
        if (['0', 'false', 'no', 'off'].includes(v)) return false;
      }
      return bad('must be true or false');
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : !strict && typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return bad('must be a number');
      if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max)) return bad(`must be between ${o.min ?? '-∞'} and ${o.max ?? '∞'}`);
      return n;
    }
    case 'choice': {
      if (typeof raw === 'string' && o.choices?.some((c) => c.value === raw.trim())) return raw.trim();
      return bad(`must be one of ${(o.choices ?? []).map((c) => c.value).join(', ')}`);
    }
    default:
      return typeof raw === 'string' ? raw : bad('must be text');
  }
}

/**
 * The settings of a plugin: configuration file value (checked strictly, an error stops startup like the rest of the
 * file), else the environment variable the manifest names (checked leniently), else the default.
 */
export function resolvePluginConfig(manifest: PluginManifest, file: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): Record<string, PluginConfigValue> {
  const out: Record<string, PluginConfigValue> = {};
  const known = new Set((manifest.config ?? []).map((o) => o.id));
  for (const key of Object.keys(file)) if (!known.has(key)) throw new ConfigError(`unknown setting "plugins.${manifest.id}.${key}" (expected ${[...known].join(', ') || 'none'})`);
  for (const o of manifest.config ?? []) {
    const where = `plugins.${manifest.id}.${o.id}`;
    let value: PluginConfigValue | undefined;
    if (file[o.id] !== undefined && file[o.id] !== null) value = coerce(o, file[o.id], where, true);
    else if (o.env && env[o.env] !== undefined && env[o.env] !== '') value = coerce(o, env[o.env], o.env, false);
    out[o.id] = value ?? o.default;
  }
  return out;
}

interface Loaded {
  info: InstalledPlugin;
  plugin: ServerPlugin;
  config: Record<string, PluginConfigValue>;
  started: boolean;
  timers: NodeJS.Timeout[];
}

/** What the server gives plugins to work with (the part of PluginHost that depends on the running server). */
export interface PluginBase {
  profile: PluginHost['profile'];
  tickRate: number;
  rooms: PluginHost['rooms'];
  stats: PluginHost['stats'];
  matches: PluginHost['matches'];
  profiles: PluginHost['profiles'];
  events: ServerEvents;
  /** where plugins keep files: each gets `<dataRoot>/<id>` */
  dataRoot: string;
}

/** Plugins built for API 1 had virtual players without asking, so they keep them; newer ones must declare the capability. */
const canSeatPlayers = (m: PluginManifest): boolean => m.apiVersion < 2 || !!m.capabilities?.includes('virtualPlayers');

/** The part of a plugin that decides who an outside process may seat: `virtualPlayers.authorizeJoin`, or the API 1 spelling. */
const joinHook = (l: Loaded): NonNullable<ServerPlugin['virtualPlayers']>['authorizeJoin'] | undefined => {
  if (!canSeatPlayers(l.info.manifest)) return undefined;
  return l.plugin.virtualPlayers?.authorizeJoin.bind(l.plugin.virtualPlayers) ?? (l.info.manifest.apiVersion < 2 ? l.plugin.authorizeJoin?.bind(l.plugin) : undefined);
};

const isPlugin = (v: unknown): v is ServerPlugin => typeof v === 'object' && v !== null && typeof (v as ServerPlugin).start === 'function';

/** Plugins that are loaded (imported and checked) and, once `start`ed, running. */
export class PluginRegistry {
  constructor(private readonly loaded: Loaded[]) {}

  get plugins(): InstalledPlugin[] {
    return this.loaded.map((l) => l.info);
  }

  get(id: string): InstalledPlugin | undefined {
    return this.loaded.find((l) => l.info.manifest.id === id)?.info;
  }

  /** Body of `/plugins/index.json`: what a client needs to load the plugins' interface. */
  index(): { plugins: { id: string; version: string; digest: string; client: boolean; http: boolean; locales?: PluginManifest['locales']; characters?: PluginManifest['characters'] }[] } {
    return {
      plugins: this.loaded.map((l) => ({
        id: l.info.manifest.id,
        version: l.info.manifest.version,
        digest: l.info.digest,
        client: 'client.mjs' in l.info.manifest.files,
        http: !!l.plugin.http,
        locales: l.info.manifest.locales,
        characters: l.info.manifest.characters,
      })),
    };
  }

  /** Start every plugin, in order. A plugin whose start fails is stopped and dropped; the others carry on. */
  async start(base: PluginBase, log: (msg: string) => void = console.log): Promise<void> {
    for (const l of [...this.loaded]) {
      const id = l.info.manifest.id;
      const host: PluginHost = {
        coreVersion: CORE_VERSION,
        dataDir: join(base.dataRoot, id),
        profile: base.profile,
        tickRate: base.tickRate,
        config: l.config,
        rooms: base.rooms,
        stats: base.stats,
        matches: base.matches,
        profiles: base.profiles,
        events: { on: (event, fn) => base.events.on(event, fn) },
        // the rooms are the same objects; the capability decides whether the plugin is handed the virtual player view
        virtualRooms: canSeatPlayers(l.info.manifest) ? (base.rooms as unknown as PluginHost['virtualRooms']) : undefined,
        games: { ais: registeredAis, playableIds: playableIdsOf },
        characters: { models: characterModels },
        plugin: <T>(other: string) => this.loaded.find((x) => x.info.manifest.id === other && x.started)?.plugin.api as T | undefined,
        every: (ms, fn) => {
          const t = setInterval(() => {
            try {
              fn();
            } catch (err) {
              log(`[party-game] plugin ${id}: ${(err as Error).message}`);
            }
          }, ms);
          t.unref();
          l.timers.push(t);
        },
        log: (m) => log(`[party-game] plugin ${id}: ${m}`),
      };
      try {
        if (l.info.manifest.apiVersion < 2) log(`[party-game] plugin ${id} is built for plugin API ${l.info.manifest.apiVersion}; rebuild it for API ${PLUGIN_API_VERSION} (it gets virtual players without declaring the capability)`);
        await l.plugin.start(host);
        l.started = true;
        log(`[party-game] plugin: ${l.info.manifest.name} ${l.info.manifest.version} (${l.info.source})`);
      } catch (err) {
        log(`[party-game] plugin ${id} failed to start: ${(err as Error).message.split('\n')[0]}`);
        this.drop(l);
      }
    }
  }

  private drop(l: Loaded): void {
    try {
      l.plugin.stop?.();
    } catch {
      /* already failing */
    }
    l.timers.forEach(clearInterval);
    unregisterCharacterModels({ kind: 'plugin', id: l.info.manifest.id });
    this.loaded.splice(this.loaded.indexOf(l), 1);
  }

  stop(): void {
    for (const l of [...this.loaded].reverse()) this.drop(l);
  }

  private started(id: string): ServerPlugin | undefined {
    return this.loaded.find((l) => l.info.manifest.id === id && l.started)?.plugin;
  }

  /** Hand a PLUGIN_ACTION to its plugin; an unknown plugin or a throwing handler is ignored. */
  onAction(room: PluginRoom, clientId: string, id: string, data: Record<string, unknown>): void {
    try {
      this.started(id)?.onAction?.(room, clientId, data);
    } catch (err) {
      console.error(`[party-game] plugin ${id} action failed`, err);
    }
  }

  /** Does this plugin answer HTTP requests? */
  hasHttp(id: string): boolean {
    return !!this.started(id)?.http;
  }

  /** Pages of the app that installed plugins draw (their manifests' `clientRoutes`). */
  clientRoutes(): string[] {
    return this.loaded.flatMap((l) => l.info.manifest.clientRoutes ?? []);
  }

  /** The started plugin that lists `path` in its manifest's `rootRoutes`, if any. */
  rootRouteOwner(path: string): string | undefined {
    return this.loaded.find((l) => l.started && l.plugin.http && l.info.manifest.rootRoutes?.includes(path))?.info.manifest.id;
  }

  /** Let a plugin answer a request to its endpoints; a throwing handler is a 500. */
  async http(id: string, req: PluginHttpRequest): Promise<PluginHttpResponse> {
    try {
      return (await this.started(id)?.http?.(req)) ?? { status: 404, body: { error: 'not found' } };
    } catch (err) {
      console.error(`[party-game] plugin ${id} request failed`, err);
      return { status: 500, body: { error: 'internal error' } };
    }
  }

  /** What an outside process may seat, or the reason it may not. */
  authorizeJoin(room: PluginRoom, id: string, claim: { token?: string; data: Record<string, unknown> }): VirtualSeat | string {
    const l = this.loaded.find((x) => x.info.manifest.id === id && x.started);
    const authorize = l && joinHook(l);
    if (!authorize) return 'This plugin cannot be joined from outside';
    try {
      return authorize(room as VirtualPlayerRoom, claim);
    } catch (err) {
      return (err as Error).message;
    }
  }

  /** The `ext` of a room's list entry: each plugin's own summary. */
  summarize(room: PluginRoom): Record<string, unknown> | undefined {
    let out: Record<string, unknown> | undefined;
    for (const l of this.loaded) {
      if (!l.started || !l.plugin.roomSummary) continue;
      try {
        const v = l.plugin.roomSummary(room);
        if (v !== undefined) (out ??= {})[l.info.manifest.id] = v;
      } catch (err) {
        console.error(`[party-game] plugin ${l.info.manifest.id} summary failed`, err);
      }
    }
    return out;
  }
}

export interface PluginLoadOptions {
  /** `all`, `none` or a comma separated list of ids */
  enabled?: string;
  /** the `plugins.<id>` settings of the configuration file */
  settings?: Record<string, Record<string, unknown>>;
  env?: NodeJS.ProcessEnv;
  /** dev source mode (`DEV_SOURCE=1`): find the plugins here instead of in the `dirs`... */
  scan?: () => PluginScan;
  /** ...and import the server code from this file instead of `<dir>/server.mjs` */
  entry?: (dir: string) => string;
}

/**
 * Scan, import and check every enabled plugin (nothing runs yet; call `start` once the rooms exist). A plugin with a
 * wrong core version, a missing or mismatching `requires`, or broken code is logged and skipped. A bad value in
 * the configuration file throws ConfigError, like every other setting.
 */
export async function loadPlugins(dirs: PluginDirs, opts: PluginLoadOptions = {}, log: (msg: string) => void = console.log): Promise<PluginRegistry> {
  const { plugins, skipped } = opts.scan ? opts.scan() : scanPlugins(dirs);
  for (const s of skipped) log(`[party-game] skipped plugin ${s.dir}: ${s.reason.split('\n')[0]}`);
  const allow = enabledFilter(opts.enabled ?? 'all');
  let pool = plugins.filter((p) => allow(p.manifest.id));
  const drop = (p: InstalledPlugin, why: string): void => {
    log(`[party-game] skipped plugin ${p.manifest.id}: ${why}`);
    pool = pool.filter((x) => x !== p);
  };
  for (const p of [...pool]) {
    const need = p.manifest.engines?.core;
    if (need && !satisfies(CORE_VERSION, need)) drop(p, `needs core ${need}, this is ${CORE_VERSION}`);
  }
  // dependencies: drop what cannot be satisfied (repeat, since dropping one can orphan its dependents)
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of [...pool]) {
      for (const [dep, range] of Object.entries(p.manifest.requires ?? {})) {
        const d = pool.find((x) => x.manifest.id === dep);
        if (!d) drop(p, `needs the "${dep}" plugin, which is not loaded`);
        else if (!satisfies(d.manifest.version, range)) drop(p, `needs ${dep} ${range}, found ${d.manifest.version}`);
        else continue;
        changed = true;
        break;
      }
    }
  }
  // order: dependencies first, then by `order` and id; a cycle drops the plugins in it
  const ordered: InstalledPlugin[] = [];
  const done = new Set<string>();
  while (pool.length > 0) {
    const next = pool.find((p) => Object.keys(p.manifest.requires ?? {}).every((d) => done.has(d)));
    if (!next) {
      for (const p of [...pool]) drop(p, 'its requires form a cycle');
      break;
    }
    ordered.push(next);
    done.add(next.manifest.id);
    pool = pool.filter((p) => p !== next);
  }
  const loaded: Loaded[] = [];
  for (const info of ordered) {
    const { manifest } = info;
    const config = resolvePluginConfig(manifest, opts.settings?.[manifest.id], opts.env);
    try {
      const mod = (await import(pathToFileURL(opts.entry ? opts.entry(info.dir) : join(info.dir, 'server.mjs')).href)) as { default?: unknown };
      if (!isPlugin(mod.default)) throw new PackError('server.mjs must export default { start }');
      registerTranslations(manifest.locales);
      for (const id of registerCharacterModels({ kind: 'plugin', id: manifest.id }, manifest.characters)) log(`[party-game] plugin ${manifest.id}: character model "${id}" is already provided by another game or plugin; ignoring this one`);
      loaded.push({ info, plugin: mod.default, config, started: false, timers: [] });
    } catch (err) {
      log(`[party-game] skipped plugin ${manifest.id}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  return new PluginRegistry(loaded);
}
