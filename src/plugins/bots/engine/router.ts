// The AI router: given what a room plays, says whether an AI exists for it and which one to use.
// Pure logic (no sockets, no threads), so the same router can sit in the companion server today and be
// embedded in the main server, or driven by a game pack, later.
import type { GameAi as GamePlugin } from '../../../core/shared/ai';
import { registeredGames } from './registry';

/** What a room plays (the game selection of WELCOME / ROOM_UPDATE). */
export interface RoomSelection {
  game: string;
  variant?: string;
  playlist?: { game: string; variant?: string }[];
}

export interface RouterConfig {
  /** level for games without their own entry; a level name, or "random" */
  level: string;
  /** per game id */
  levels?: Record<string, string>;
  /** per game id */
  policies?: Record<string, string>;
  /** parameter overrides applied on top of the level */
  params?: Record<string, number>;
  /** rooms that rotate through every game: "never" (default) or "always" (the bot idles in rounds it cannot play) */
  mixed?: 'never' | 'always';
  /** custom playlists: join when the AI knows "any" game of it (idles in the others) or only when it knows "all" */
  playlistJoin?: 'any' | 'all';
}

export interface BotPlan {
  gameId: string;
  level: string;
  policy: string;
  params: Record<string, number>;
}

export type Verdict = { ok: true; games: string[] } | { ok: false; reason: string };

const MIXED = 'mixed';
const CUSTOM = 'custom';

export class AiRouter {
  constructor(
    private readonly cfg: RouterConfig,
    private readonly games: () => GamePlugin[] = registeredGames,
    private readonly rng: () => number = Math.random,
  ) {}

  /** The games that have an AI: id, levels and policies (for dashboards). */
  catalog(): { id: string; kind: string; levels: string[]; policies: string[]; level: string }[] {
    return this.games().map((g) => ({ id: g.id, kind: g.kind, levels: Object.keys(g.levels ?? {}), policies: g.policies, level: this.levelFor(g) }));
  }

  private plugin(id: string): GamePlugin | undefined {
    return this.games().find((g) => g.id === id);
  }

  /** Is there an AI for everything this room will play? */
  supports(sel: RoomSelection): Verdict {
    if (sel.game === MIXED) return this.cfg.mixed === 'always' && this.games().length ? { ok: true, games: this.games().map((g) => g.id) } : { ok: false, reason: 'the room rotates through every game' };
    if (sel.game === CUSTOM) {
      const ids = [...new Set((sel.playlist ?? []).map((e) => e.game))];
      if (!ids.length) return { ok: false, reason: 'empty playlist' };
      const known = ids.filter((id) => this.plugin(id));
      const missing = ids.filter((id) => !this.plugin(id));
      if (!known.length) return { ok: false, reason: `no AI for ${missing.join(', ')}` };
      if (missing.length && this.cfg.playlistJoin === 'all') return { ok: false, reason: `no AI for ${missing.join(', ')}` };
      return { ok: true, games: known };
    }
    return this.plugin(sel.game) ? { ok: true, games: [sel.game] } : { ok: false, reason: `no AI for ${sel.game}` };
  }

  private levelFor(g: GamePlugin, force?: string): string {
    const lv = force ?? this.cfg.levels?.[g.id] ?? this.cfg.level;
    const names = Object.keys(g.levels ?? {});
    if (lv === 'random' && names.length) return names[Math.floor(this.rng() * names.length)];
    return lv;
  }

  /** The bot to send into a room, or null when there is no AI for it. `level` overrides the configured one (manual add). */
  plan(sel: RoomSelection, opts: { level?: string } = {}): BotPlan | null {
    const v = this.supports(sel);
    if (!v.ok) return null;
    const first = sel.game === MIXED || sel.game === CUSTOM ? v.games[0] : sel.game;
    const g = this.plugin(first);
    if (!g) return null;
    const forced = opts.level && (opts.level === 'random' || g.levels?.[opts.level]) ? opts.level : undefined;
    const level = this.levelFor(g, forced);
    const known = !level || g.levels?.[level];
    return {
      gameId: g.id,
      level: known ? level : (g.defaultLevel ?? ''),
      policy: this.cfg.policies?.[g.id] ?? g.defaultPolicy,
      params: { ...this.cfg.params },
    };
  }
}
