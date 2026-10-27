/**
 * Catalog of games a host can choose when creating a room. Data only, shared
 * by the client UI and server validation. The server registry
 * (server/minigames/index.ts) must provide a factory for every playable id.
 */
import type { Guide } from './guides';
import type { OptionGroup } from './option-groups';
import { t, tr, type Localized } from './i18n';

export type OptionValue = number | boolean | string;

/**
 * A host-configurable setting shown under "Advanced options". Values are
 * validated server-side against this definition, so UI and rules can't drift.
 */
export interface OptionDef {
  id: string;
  label: string;
  /** One short hint under the control. */
  description: string;
  type: 'number' | 'boolean' | 'choice';
  default: OptionValue;
  /** shown instead of the number when it is 0, e.g. "No maximum" */
  zeroLabel?: string;
  min?: number;
  max?: number;
  step?: number;
  /** unit suffix for numbers, e.g. "s" */
  unit?: string;
  choices?: { value: string; label: string }[];
  /** Section of the options panel; defaults to the id's entry in `option-groups.ts`. */
  group?: OptionGroup;
}

/** Locale key suffix (`action.<x>`) of the big on-screen action button. */
export const ACTION_KINDS = ['dash', 'boost', 'grab', 'kick', 'charge', 'fire', 'act', 'mine', 'jump'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * Fixed vocabulary of game tags (how a round is won, what it is played with, what to expect). A game picks
 * from it in its game.json; labels are the UI strings `tag.<id>`. Add a tag here and in every locale.
 */
export const GAME_TAGS = ['last-standing', 'race', 'points', 'turn-based', 'ball', 'vehicle', 'hazards'] as const;
export type GameTag = (typeof GAME_TAGS)[number];
export const isGameTag = (v: unknown): v is GameTag => (GAME_TAGS as readonly unknown[]).includes(v);

export interface CatalogVariant {
  /** Tags of this variant; absent: the game's. */
  tags?: GameTag[];
  /** Label of the action button / controls hint. */
  action: ActionKind;
  /** Label of the secondary button (a2), when the game uses one. */
  action2?: ActionKind;
  id: string;
  /** Minimal how-to-play: objective, rules and items. */
  guide: Guide;
  name: string;
  /** One short sentence shown in the room-creation panel. */
  description: string;
  /** Variant-specific options (override same-id game options). */
  options?: OptionDef[];
  /** Strict most players this variant supports; overrides the game's. Absent: no limit beyond the room's. */
  maxPlayers?: number;
  /** Supports team play; overrides the game's. */
  teams?: boolean;
  /** Most members of one team; overrides the game's. Absent: no limit beyond the room's. */
  maxTeamSize?: number;
}

export interface CatalogGame {
  /** Tags of the game and of every variant without its own. Absent: none. */
  tags?: GameTag[];
  /** Action label for games without variants (variants carry their own). */
  action: ActionKind;
  /** Secondary button label for games without variants (variants carry their own). */
  action2?: ActionKind;
  id: string;
  /** Minimal how-to-play: objective, rules and items. */
  guide: Guide;
  name: string;
  description: string;
  /** Options shared by every variant of the game. */
  options?: OptionDef[];
  /** Strict most players the game (every variant without its own limit) supports. Absent: no limit. */
  maxPlayers?: number;
  /** Supports team play (teams share their members' points and wins). Absent: false. */
  teams?: boolean;
  /** Most members of one team (applies to every variant without its own). Absent: no limit beyond the room's. */
  maxTeamSize?: number;
  /** Short note shown under the touch-controls settings, e.g. which move control suits the game. */
  touchHint?: Localized;
  /** Empty when the game has no variants. */
  variants: CatalogVariant[];
}

export const CATALOG: CatalogGame[] = [
];

/** Tags of a variant (its own, else the game's), or of the game itself. */
export function tagsOf(game: Pick<CatalogGame, 'tags'>, variant?: Pick<CatalogVariant, 'tags'>): readonly GameTag[] {
  return variant?.tags ?? game.tags ?? [];
}

/** Every tag the games in `list` use, in vocabulary order (what a tag filter can offer). */
export function tagsInUse(list: readonly CatalogGame[]): GameTag[] {
  const used = new Set<GameTag>();
  for (const g of list) {
    for (const x of tagsOf(g)) used.add(x);
    for (const v of g.variants) for (const x of tagsOf(g, v)) used.add(x);
  }
  return GAME_TAGS.filter((x) => used.has(x));
}

/**
 * The games and variants that carry every tag in `tags` (none selected: `list` itself). A game with variants
 * keeps only the matching ones; one without variants matches on its own tags.
 */
export function filterByTags(list: CatalogGame[], tags: readonly GameTag[]): CatalogGame[] {
  if (tags.length === 0) return list;
  const has = (own: readonly GameTag[]) => tags.every((x) => own.includes(x));
  const out: CatalogGame[] = [];
  for (const g of list) {
    if (g.variants.length === 0) {
      if (has(tagsOf(g))) out.push(g);
      continue;
    }
    const variants = g.variants.filter((v) => has(tagsOf(g, v)));
    if (variants.length > 0) out.push(variants.length === g.variants.length ? g : { ...g, variants });
  }
  return out;
}

/**
 * The catalog without what an operator switched off. `disabled` holds game ids (a family and all its
 * variants) and/or variant ids. A family left with no variant (it had some) is dropped too.
 */
export function filterCatalog(disabled: Iterable<string>): CatalogGame[] {
  const off = new Set(disabled);
  if (off.size === 0) return CATALOG;
  const out: CatalogGame[] = [];
  for (const g of CATALOG) {
    if (off.has(g.id)) continue;
    if (g.variants.length === 0) {
      out.push(g);
      continue;
    }
    const variants = g.variants.filter((v) => !off.has(v.id));
    if (variants.length > 0) out.push({ ...g, variants });
  }
  return out;
}

export const MIXED = 'mixed';
export const ALL_VARIANTS = 'all';
/** `game` of a selection that carries its own ordered `playlist` */
export const CUSTOM = 'custom';
/** Most rounds a custom playlist may have. */
export const MAX_PLAYLIST = 10;

export const MIXED_DESCRIPTION = 'Rotates through every game and variant.';
export const ALL_VARIANTS_DESCRIPTION = 'Plays each variant in turn.';

export interface GameSelection {
  /** `mixed` or a catalog game id */
  game: string;
  /** `all` or a variant id of `game` */
  variant: string;
  /** Only values that differ from the defaults; validated by `normalizeSelection`. */
  options: Record<string, OptionValue>;
  /** Present when `game` is `custom`: the rounds, in order, each with its own options. */
  playlist?: PlaylistEntry[];
  /** Custom playlists only: round wins for entries that don't set `roundsToWin` themselves. */
  playlistRoundsToWin?: number;
}

/** One concrete round of a custom playlist (never `mixed` / `all` for games that have variants). */
export type PlaylistEntry = Omit<GameSelection, 'playlist' | 'playlistRoundsToWin'>;

export const DEFAULT_SELECTION: GameSelection = { game: MIXED, variant: ALL_VARIANTS, options: {} };

export interface PlayableGame {
  /** Unique id: the variant id, or the game id for games without variants. */
  id: string;
  game: string;
  name: string;
}

export function playablesOf(g: CatalogGame): PlayableGame[] {
  if (g.variants.length === 0) return [{ id: g.id, game: g.id, name: g.name }];
  return g.variants.map((v) => ({ id: v.id, game: g.id, name: v.name }));
}

export const ALL_PLAYABLES: PlayableGame[] = CATALOG.flatMap(playablesOf);

/**
 * Add games from installed packs. Call once at boot (server and client), before any selection is
 * validated. `CATALOG` and `ALL_PLAYABLES` are updated in place so existing references stay live.
 * Throws when an id (game or playable) is already taken.
 */
export function registerGames(entries: CatalogGame[]): void {
  const taken = new Set<string>([...CATALOG.map((g) => g.id), ...ALL_PLAYABLES.map((p) => p.id)]);
  for (const g of entries) {
    const ids = [g.id, ...g.variants.map((v) => v.id)];
    const clash = ids.find((id) => taken.has(id));
    if (clash) throw new Error(`game id "${clash}" is already registered`);
    for (const id of ids) taken.add(id);
    CATALOG.push(g);
    ALL_PLAYABLES.push(...playablesOf(g));
  }
}

/** Remove registered games by game id (tests, and a pack that failed to finish loading). */
export function unregisterGames(ids: Iterable<string>): void {
  const off = new Set(ids);
  for (let i = CATALOG.length - 1; i >= 0; i--) if (off.has(CATALOG[i].id)) CATALOG.splice(i, 1);
  ALL_PLAYABLES.length = 0;
  ALL_PLAYABLES.push(...CATALOG.flatMap(playablesOf));
}

/**
 * Playable ids a per-game filter id (the leaderboard plugin's) stands for: every variant of a game family, or the one playable
 * for a variant id; null when the id is unknown.
 */
export function playableIdsOf(id: string): Set<string> | null {
  const fam = ALL_PLAYABLES.filter((p) => p.game === id);
  if (fam.length > 0) return new Set(fam.map((p) => p.id));
  return ALL_PLAYABLES.some((p) => p.id === id) ? new Set([id]) : null;
}

/** Display name of a variant (or game) id from the catalog; falls back to the id with hyphens as spaces. */
export function variantName(id: string): string {
  return ALL_PLAYABLES.find((p) => p.id === id)?.name ?? id.replace(/-/g, ' ');
}

/** Catalog game (family) id of a playable id; '' when unknown. */
export function gameIdOf(playableId: string): string {
  return ALL_PLAYABLES.find((p) => p.id === playableId)?.game ?? '';
}

/** Action-button kind of a playable id (variant id, or game id for games without variants). */
export function actionFor(id: string): ActionKind {
  for (const g of CATALOG) {
    if (g.id === id && g.variants.length === 0) return g.action;
    const v = g.variants.find((x) => x.id === id);
    if (v) return v.action;
  }
  return 'dash';
}

/** Secondary-button kind of a playable id, or undefined when the game has only one action. */
export function secondaryActionFor(id: string): ActionKind | undefined {
  for (const g of CATALOG) {
    if (g.id === id && g.variants.length === 0) return g.action2;
    const v = g.variants.find((x) => x.id === id);
    if (v) return v.action2 ?? g.action2;
  }
  return undefined;
}

/**
 * Option ids that were renamed: the old id still loads from saved playlists and operator defaults.
 * (All "X variance" options share one name pattern; `spawnJitter` was a fraction, now seconds: the old
 * value just becomes a small number of seconds.)
 */
export const OPTION_ALIASES: Readonly<Record<string, string>> = {
  walrusJitter: 'walrusVariance',
  meltJitter: 'meltVariance',
  spawnJitter: 'spawnDelayVariance',
};
const canonicalOption = (id: string): string => OPTION_ALIASES[id] ?? id;

/** Operator-set defaults: `{ [game id or variant id]: { [option id]: value } }`. */
export type DefaultOverrides = Record<string, Record<string, OptionValue>>;

let overrides: DefaultOverrides = {};

/** Replace the operator-set defaults (config file + admin). Ids and values are validated by the caller. */
export function setDefaultOverrides(next: DefaultOverrides): void {
  overrides = next;
}

export function getDefaultOverrides(): DefaultOverrides {
  return overrides;
}

/** Id of the option every game / variant (and `mixed`) has: round wins needed to win the match. */
export const ROUNDS_TO_WIN = 'roundsToWin';
export const DEFAULT_ROUNDS_TO_WIN = 3;
export const MAX_ROUNDS_TO_WIN = 10;

export const ROUNDS_TO_WIN_OPTION: OptionDef = {
  id: ROUNDS_TO_WIN,
  label: 'Rounds to win',
  description: 'Round wins a player needs to win the match.',
  type: 'number',
  default: DEFAULT_ROUNDS_TO_WIN,
  min: 1,
  max: MAX_ROUNDS_TO_WIN,
  step: 1,
};

function withRounds(defs: OptionDef[]): OptionDef[] {
  return defs.some((d) => d.id === ROUNDS_TO_WIN) ? defs : [...defs, ROUNDS_TO_WIN_OPTION];
}

function baseOptionsFor(game: string, variant: string): OptionDef[] {
  if (game === MIXED) return [ROUNDS_TO_WIN_OPTION];
  const g = CATALOG.find((c) => c.id === game);
  if (!g) return [];
  const own = g.options ?? [];
  const v = g.variants.find((x) => x.id === variant);
  if (!v) return withRounds(own);
  const byId = new Map<string, OptionDef>(own.map((o) => [o.id, o]));
  for (const o of v.options ?? []) byId.set(o.id, o);
  return withRounds([...byId.values()]);
}

/**
 * Options available for a (game, variant) choice; empty for mixed / rotating variants.
 * `default` is the effective one: the variant's override, else the game's, else the built-in.
 */
export function optionsFor(game: string, variant: string): OptionDef[] {
  const defs = baseOptionsFor(game, variant);
  const byGame = overrides[game];
  const byVariant = overrides[variant];
  if (!byGame && !byVariant) return defs;
  return defs.map((d) => {
    const raw = byVariant?.[d.id] ?? byGame?.[d.id];
    const val = raw === undefined ? undefined : coerceOption(d, raw);
    return val === undefined ? d : { ...d, default: val };
  });
}

/** Where an option of a variant comes from: shared by every variant of its game (`core`) or only this one. */
export type OptionSource = 'core' | 'variant';

/**
 * For a game with several variants, whether each option of `variant` is a core option (every variant of the
 * game offers that id) or specific to the variant. Empty for games without variants, `mixed` and `all`.
 */
export function optionSources(game: string, variant: string): Record<string, OptionSource> {
  const g = CATALOG.find((c) => c.id === game);
  if (!g || g.variants.length < 2 || !g.variants.some((v) => v.id === variant)) return {};
  const lists = g.variants.map((v) => baseOptionsFor(g.id, v.id));
  const out: Record<string, OptionSource> = {};
  for (const d of baseOptionsFor(g.id, variant)) out[d.id] = lists.every((l) => l.some((x) => x.id === d.id)) ? 'core' : 'variant';
  return out;
}

/** Built-in (never overridden) options, for showing what a default was before an operator changed it. */
export function builtinOptionsFor(game: string, variant: string): OptionDef[] {
  return baseOptionsFor(game, variant);
}

/**
 * Effective defaults of one playable (variant id, or game id when it has no variants).
 * `onlyChanged` keeps just the options an operator moved away from the built-in default.
 */
export function effectiveDefaults(playableId: string, onlyChanged = false): Record<string, OptionValue> {
  for (const g of CATALOG) {
    if (g.id === playableId || g.variants.some((v) => v.id === playableId)) {
      const variant = g.variants.some((v) => v.id === playableId) ? playableId : ALL_VARIANTS;
      const all = defaultOptions(optionsFor(g.id, variant));
      if (!onlyChanged) return all;
      const base = defaultOptions(baseOptionsFor(g.id, variant));
      return Object.fromEntries(Object.entries(all).filter(([k, v]) => base[k] !== v));
    }
  }
  return {};
}

export interface PublishedSetting {
  id: string;
  label: string;
  description: string;
  type: OptionDef['type'];
  default: OptionValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: { value: string; label: string }[];
}

/**
 * Every configurable setting per game and variant with its allowed values and built-in default:
 * the contract the config file, admin API and config.example.yaml are all checked against.
 * `target` is the id used under `games.defaults` (game id, or variant id).
 */
export function publishedSettings(): {
  target: string;
  game: string;
  name: string;
  maxPlayers?: number;
  teams?: boolean;
  maxTeamSize?: number;
  settings: PublishedSetting[];
}[] {
  const pick = (d: OptionDef): PublishedSetting => {
    const { id, label, description, type, default: def, min, max, step, unit, choices } = d;
    return { id, label, description, type, default: def, min, max, step, unit, choices };
  };
  const out: ReturnType<typeof publishedSettings> = [];
  const teamInfo = (teams: boolean | undefined, size: number | undefined) => ({
    ...(teams ? { teams: true } : {}),
    ...(teams && size !== undefined ? { maxTeamSize: size } : {}),
  });
  for (const g of CATALOG) {
    // a game-level key applies to every variant that has the option; only options that are the
    // same in every variant (same default and limits) are published there, the rest per variant
    const lists = g.variants.length > 0 ? g.variants.map((v) => baseOptionsFor(g.id, v.id)) : [withRounds(g.options ?? [])];
    const common = lists[0]!.filter((d) => lists.every((l) => l.some((x) => JSON.stringify(x) === JSON.stringify(d))));
    out.push({ target: g.id, game: g.id, name: g.name, ...(g.maxPlayers !== undefined ? { maxPlayers: g.maxPlayers } : {}), ...teamInfo(g.teams, g.maxTeamSize), settings: common.map(pick) });
    for (const v of g.variants) {
      const max = v.maxPlayers ?? g.maxPlayers;
      out.push({
        target: v.id,
        game: g.id,
        name: v.name,
        ...(max !== undefined ? { maxPlayers: max } : {}),
        ...teamInfo(v.teams ?? g.teams, v.maxTeamSize ?? g.maxTeamSize),
        settings: baseOptionsFor(g.id, v.id).map(pick),
      });
    }
  }
  return out;
}

/**
 * Validate operator-written defaults. Returns the cleaned map and one message per problem.
 * A game-level key must be valid for every variant of that game that has the option.
 */
export function validateDefaults(raw: unknown): { value: DefaultOverrides; errors: string[] } {
  const value: DefaultOverrides = {};
  const errors: string[] = [];
  if (raw === null || raw === undefined) return { value, errors };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { value, errors: ['must be a mapping of game or variant ids'] };
  for (const [target, opts] of Object.entries(raw as Record<string, unknown>)) {
    const g = CATALOG.find((c) => c.id === target);
    const v = g ? undefined : CATALOG.find((c) => c.variants.some((x) => x.id === target));
    if (!g && !v) {
      errors.push(`unknown game or variant "${target}"`);
      continue;
    }
    if (opts === null || opts === undefined) continue;
    if (typeof opts !== 'object' || Array.isArray(opts)) {
      errors.push(`"${target}" must be a mapping of option ids`);
      continue;
    }
    const family = g ?? v!;
    const defsFor = (id: string): OptionDef[] =>
      g
        ? withRounds([...(g.options ?? []), ...g.variants.flatMap((x) => x.options ?? [])]).filter((d) => d.id === id)
        : baseOptionsFor(family.id, target).filter((d) => d.id === id);
    for (const [oldId, val] of Object.entries(opts as Record<string, unknown>)) {
      const id = canonicalOption(oldId);
      const defs = defsFor(id);
      if (defs.length === 0) {
        errors.push(`"${target}" has no option "${id}"`);
        continue;
      }
      const bad = defs.find((d) => {
        const c = coerceOption(d, val);
        return c === undefined || c !== val;
      });
      if (bad) {
        const range = bad.type === 'number' ? ` (${bad.min ?? '-∞'} to ${bad.max ?? '∞'}${bad.step ? `, step ${bad.step}` : ''})` : bad.type === 'choice' ? ` (one of ${bad.choices?.map((c) => c.value).join(', ')})` : ' (true or false)';
        errors.push(`"${target}.${id}" is invalid${range}: ${JSON.stringify(val)}`);
        continue;
      }
      (value[target] ??= {})[id] = val as OptionValue;
    }
  }
  return { value, errors };
}

export function defaultOptions(defs: OptionDef[]): Record<string, OptionValue> {
  return Object.fromEntries(defs.map((d) => [d.id, d.default]));
}

/** Clamp/snap a single value. Returns undefined when the type is wrong. */
export function coerceOption(def: OptionDef, raw: unknown): OptionValue | undefined {
  switch (def.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      const min = def.min ?? -Infinity;
      const max = def.max ?? Infinity;
      let v = Math.min(max, Math.max(min, raw));
      if (def.step) {
        // Anchor the grid at min; without a min the range input's default is 0.
        const anchor = Number.isFinite(min) ? min : 0;
        v = anchor + Math.round((v - anchor) / def.step) * def.step;
        v = Math.min(max, Math.max(min, v));
        v = Math.round(v * 1000) / 1000;
      }
      return v;
    }
    case 'choice':
      return typeof raw === 'string' && def.choices?.some((c) => c.value === raw) ? raw : undefined;
  }
}

/** Validate untrusted input. Returns null when the combination is invalid. */
export function normalizeSelection(
  game?: unknown,
  variant?: unknown,
  options?: unknown,
  playlist?: unknown,
  playlistRoundsToWin?: unknown,
): GameSelection | null {
  if (playlist !== undefined && playlist !== null) {
    if (!Array.isArray(playlist) || playlist.length < 1 || playlist.length > MAX_PLAYLIST) return null;
    const entries: PlaylistEntry[] = [];
    for (const e of playlist) {
      if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
      const r = e as Record<string, unknown>;
      const g = typeof r.game === 'string' ? CATALOG.find((c) => c.id === r.game) : undefined;
      if (!g) return null; // also rejects `mixed` and `custom`
      // a round is one concrete variant; only games without variants may leave it out
      if (g.variants.length > 0 && (typeof r.variant !== 'string' || r.variant === ALL_VARIANTS)) return null;
      const sel = normalizeSelection(r.game, r.variant, r.options);
      if (!sel) return null;
      entries.push({ game: sel.game, variant: sel.variant, options: sel.options });
    }
    const out: GameSelection = { game: CUSTOM, variant: ALL_VARIANTS, options: {}, playlist: entries };
    if (playlistRoundsToWin !== undefined && playlistRoundsToWin !== null) {
      const v = coerceOption(ROUNDS_TO_WIN_OPTION, playlistRoundsToWin);
      if (v === undefined) return null;
      if (v !== DEFAULT_ROUNDS_TO_WIN) out.playlistRoundsToWin = v as number;
    }
    return out;
  }
  const hasOptions = options !== undefined && options !== null;
  if (hasOptions && (typeof options !== 'object' || Array.isArray(options))) return null;
  const raw: Record<string, unknown> = {};
  if (hasOptions) for (const [k, v] of Object.entries(options as Record<string, unknown>)) raw[canonicalOption(k)] = v;
  const rawKeys = Object.keys(raw);

  const finish = (g: string, v: string): GameSelection | null => {
    const defs = optionsFor(g, v);
    const out: Record<string, OptionValue> = {};
    for (const key of rawKeys) {
      const def = defs.find((d) => d.id === key);
      if (!def) return null;
      const val = coerceOption(def, raw[key]);
      if (val === undefined) return null;
      if (val !== def.default) out[key] = val;
    }
    return { game: g, variant: v, options: out };
  };

  if (game === undefined || game === null || game === '') return finish(MIXED, ALL_VARIANTS);
  if (typeof game !== 'string') return null;
  if (variant !== undefined && variant !== null && typeof variant !== 'string') return null;
  if (game === MIXED) return finish(MIXED, ALL_VARIANTS);
  const g = CATALOG.find((c) => c.id === game);
  if (!g) return null;
  if (variant === undefined || variant === null || variant === '' || variant === ALL_VARIANTS || g.variants.length === 0) {
    return finish(g.id, ALL_VARIANTS);
  }
  return g.variants.some((v) => v.id === variant) ? finish(g.id, variant) : null;
}

/** Playable (variant id, or game id when it has none) of a concrete round. */
function playableOf(e: Pick<PlaylistEntry, 'game' | 'variant'>): PlayableGame {
  const g = CATALOG.find((c) => c.id === e.game);
  const v = g?.variants.find((x) => x.id === e.variant);
  return v && g ? { id: v.id, game: g.id, name: v.name } : { id: e.game, game: e.game, name: g?.name ?? e.game };
}

/** The rounds of a selection in play order, each with the options it runs with. */
export function selectionRounds(sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>): (PlayableGame & { options: Record<string, OptionValue> })[] {
  if (sel.game === CUSTOM && sel.playlist?.length) return sel.playlist.map((e) => ({ ...playableOf(e), options: e.options }));
  return playlistFor(sel).map((p) => ({ ...p, options: sel.options ?? {} }));
}

/** One stage of a match: rounds are played until somebody has `roundsToWin` wins. */
export interface Stage {
  roundsToWin: number;
}

/**
 * The stages of a match: one per custom-playlist entry (its own `roundsToWin`, else the playlist's
 * default, else the arena's effective default), otherwise a single stage using the selection's option.
 */
export function stagesOf(sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>): Stage[] {
  if (sel.game === CUSTOM && sel.playlist?.length) {
    return sel.playlist.map((e) => {
      const own = e.options?.[ROUNDS_TO_WIN];
      if (typeof own === 'number') return { roundsToWin: own };
      if (sel.playlistRoundsToWin !== undefined) return { roundsToWin: sel.playlistRoundsToWin };
      const eff = optionsFor(e.game, e.variant).find((d) => d.id === ROUNDS_TO_WIN)?.default;
      return { roundsToWin: typeof eff === 'number' ? eff : DEFAULT_ROUNDS_TO_WIN };
    });
  }
  const own = sel.options?.[ROUNDS_TO_WIN];
  const eff = optionsFor(sel.game, sel.variant).find((d) => d.id === ROUNDS_TO_WIN)?.default;
  const n = typeof own === 'number' ? own : typeof eff === 'number' ? eff : DEFAULT_ROUNDS_TO_WIN;
  return [{ roundsToWin: n }];
}

/** Games played, in order, by one match; rounds index into it cyclically. */
export function playlistFor(sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>): PlayableGame[] {
  if (sel.game === CUSTOM && sel.playlist?.length) return sel.playlist.map(playableOf);
  if (sel.game === MIXED) return ALL_PLAYABLES;
  const g = CATALOG.find((c) => c.id === sel.game);
  if (!g) return ALL_PLAYABLES;
  const all = playablesOf(g);
  if (sel.variant === ALL_VARIANTS) return all;
  return all.filter((p) => p.id === sel.variant);
}

/** Most players a playable (variant id, or game id when it has no variants) supports; undefined = no limit. */
export function playerLimitOf(playableId: string): number | undefined {
  for (const g of CATALOG) {
    const v = g.variants.find((x) => x.id === playableId);
    if (v) return v.maxPlayers ?? g.maxPlayers;
    if (g.id === playableId) return g.maxPlayers;
  }
  return undefined;
}

/** Does a playable (variant id, or game id when it has no variants) support team play? */
export function supportsTeams(playableId: string): boolean {
  for (const g of CATALOG) {
    const v = g.variants.find((x) => x.id === playableId);
    if (v) return v.teams ?? g.teams ?? false;
    if (g.id === playableId) return g.teams ?? false;
  }
  return false;
}

/** Most members of one team a playable supports; undefined = no limit. */
export function teamSizeLimitOf(playableId: string): number | undefined {
  for (const g of CATALOG) {
    const v = g.variants.find((x) => x.id === playableId);
    if (v) return v.maxTeamSize ?? g.maxTeamSize;
    if (g.id === playableId) return g.maxTeamSize;
  }
  return undefined;
}

/** Can a round with this playable id be played by `players` people? */
export function fitsPlayers(playableId: string, players: number): boolean {
  const max = playerLimitOf(playableId);
  return max === undefined || players <= max;
}

/**
 * An explicit game, variant or custom playlist must suit the players in every round (it is blocked
 * otherwise); mixed / all-variants rotations skip the rounds that do not fit instead.
 */
function isStrictSelection(sel: Pick<GameSelection, 'game' | 'variant'>): boolean {
  return sel.game === CUSTOM || (sel.game !== MIXED && sel.variant !== ALL_VARIANTS);
}

/**
 * Most players a room on this selection can hold, or undefined for no limit: the strictest round for a
 * strict selection, the most permissive one for a rotation (rounds that do not fit are skipped).
 */
export function selectionPlayerLimit(sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>): number | undefined {
  const limits = selectionRounds(sel).map((r) => playerLimitOf(r.id) ?? Infinity);
  const n = isStrictSelection(sel) ? Math.min(...limits) : Math.max(...limits);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Why `players` people cannot play this selection: the first round that is over its limit and that
 * limit, or null when it is fine. A rotation only conflicts when no round fits at all.
 */
export function playerCountConflict(
  sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>,
  players: number,
): { name: string; max: number } | null {
  const rounds = selectionRounds(sel);
  const over = rounds.filter((r) => !fitsPlayers(r.id, players));
  if (over.length === 0) return null;
  if (!isStrictSelection(sel) && over.length < rounds.length) return null;
  const first = over[0]!;
  return { name: first.name, max: playerLimitOf(first.id)! };
}

/**
 * Can a room on this selection play in teams? Every round must support them, so one team setup stays
 * valid for the whole match.
 */
export function selectionSupportsTeams(sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>): boolean {
  return selectionRounds(sel).every((r) => supportsTeams(r.id));
}

/** Most members of one team across the selection's rounds, or undefined for no limit. */
export function selectionTeamSizeLimit(sel: Pick<GameSelection, 'game' | 'variant'> & Partial<GameSelection>): number | undefined {
  const n = Math.min(...selectionRounds(sel).map((r) => teamSizeLimitOf(r.id) ?? Infinity));
  return Number.isFinite(n) ? n : undefined;
}

export function describeSelection(sel: GameSelection): string {
  const custom = Object.keys(sel.options ?? {}).length > 0 ? ` (${t('sel.custom')})` : '';
  if (sel.game === CUSTOM) return t('sel.playlist', { n: sel.playlist?.length ?? 0 });
  if (sel.game === MIXED) return t('sel.mixed');
  const g = CATALOG.find((c) => c.id === sel.game);
  if (!g) return t('sel.mixed');
  if (g.variants.length === 0) return g.name + custom;
  const v = g.variants.find((x) => x.id === sel.variant);
  return (v ? `${g.name} - ${v.name}` : `${g.name} - ${t('sel.allVariants')}`) + custom;
}

/** Human-readable list of the non-default options, e.g. ["Lives per side: 8"]. */
export function describeOptions(sel: GameSelection): string[] {
  const defs = optionsFor(sel.game, sel.variant);
  const out: string[] = [];
  for (const [id, value] of Object.entries(sel.options ?? {})) {
    const def = defs.find((d) => d.id === id);
    if (!def) continue;
    let shown = String(value);
    if (def.type === 'boolean') shown = value ? t('opt.on') : t('opt.off');
    else if (def.type === 'choice') {
      const label = def.choices?.find((c) => c.value === value)?.label;
      if (label) shown = tr(label);
    } else if (def.zeroLabel && value === 0) shown = tr(def.zeroLabel);
    else if (def.unit) shown += def.unit;
    out.push(`${tr(def.label)}: ${shown}`);
  }
  return out;
}
