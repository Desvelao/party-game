import {
  COLORBLIND_PALETTE,
  COLORBLIND_TEAM_PALETTE,
  DEFAULT_SELECTION,
  PALETTE,
  TEAM_PALETTE,
  defaultAccessPrefs,
  lookOf,
  markerFor,
  type AccessPrefs,
  type CharacterModelDef,
  type GameSelection,
  type Looks,
  type ModelLook,
  type PlayerInfo,
  RoomPhase,
  ServerConfigInfo,
  type VoteInfo,
} from '../../shared';

const NO_LOOKS: Looks = {};
/** looks object of a player (replaced with every room update) -> model id -> complete look */
const lookCache = new WeakMap<Looks, Map<string, ModelLook>>();

/** Client-side view of the room, driven entirely by server messages. */
export const session = {
  myId: '',
  code: '',
  hostId: '',
  phase: 'lobby' as RoomPhase,
  players: [] as PlayerInfo[],
  /** watching only: no paddle, no input, not in `players` */
  spectator: false,
  spectators: 0,
  watchers: [] as { id: string; name: string }[],
  locked: false,
  lateJoin: false,
  catchUp: 50,
  /** newcomers need a password */
  passwordProtected: false,
  /** the password, when this client knows it (the host always; others if they joined with it) */
  password: null as string | null,
  /** this room's player cap (host-adjustable) */
  /** accessibility display options (set from the player's preferences, kept across rooms) */
  access: defaultAccessPrefs() as AccessPrefs,
  maxPlayers: 0,
  /** state kept by installed plugins for this room, by plugin id */
  ext: {} as Record<string, unknown>,
  /** the room plays in teams (players carry `team`) and the most members of one team (0 = unlimited) */
  teams: false,
  teamSize: 0,
  config: null as ServerConfigInfo | null,
  selection: { ...DEFAULT_SELECTION } as GameSelection,
  /** id of the minigame/variant being played (from GAME_START), '' in the lobby */
  playingId: '',
  /** running restart vote (null = none) and when it times out locally */
  vote: null as VoteInfo | null,
  voteEndsAt: 0,

  get isHost(): boolean {
    return this.myId !== '' && this.myId === this.hostId;
  },
  /** Colour assigned by the server (preferred colour, unique inside the room). */
  colorOf(id: string): number {
    const p = this.players.find((q) => q.id === id);
    const cb = this.access.colorblind;
    if (this.teams && p?.team !== undefined) return (cb ? COLORBLIND_TEAM_PALETTE : TEAM_PALETTE)[p.team % TEAM_PALETTE.length]!;
    return (cb ? COLORBLIND_PALETTE : PALETTE)[(p?.color ?? 0) % PALETTE.length]!;
  },
  teamColorOf(team: number): number {
    return (this.access.colorblind ? COLORBLIND_TEAM_PALETTE : TEAM_PALETTE)[team % TEAM_PALETTE.length]!;
  },
  /** A player's look of `model` (their saved one, else the model's default); cached per room update, as it is read every frame. */
  lookOf(id: string, model: CharacterModelDef): ModelLook {
    const looks = this.players.find((p) => p.id === id)?.looks ?? NO_LOOKS;
    let byModel = lookCache.get(looks);
    if (!byModel) lookCache.set(looks, (byModel = new Map()));
    let look = byModel.get(model.id);
    if (!look) byModel.set(model.id, (look = lookOf(looks, model)));
    return look;
  },
  nameOf(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? '?';
  },
  /** In-game label: the name, with a number + shape marker in front when that option is on. */
  labelOf(id: string): string {
    const i = this.players.findIndex((p) => p.id === id);
    return this.access.markers && i >= 0 ? `${markerFor(i)} ${this.nameOf(id)}` : this.nameOf(id);
  },
};

/** Forget everything tied to the current room (keeps `config`, which the next WELCOME replaces). */
export function resetSession(): void {
  session.myId = '';
  session.code = '';
  session.hostId = '';
  session.phase = 'lobby';
  session.players = [];
  session.spectator = false;
  session.spectators = 0;
  session.watchers = [];
  session.locked = false;
  session.lateJoin = false;
  session.catchUp = 50;
  session.passwordProtected = false;
  session.password = null;
  session.maxPlayers = 0;
  session.ext = {};
  session.teams = false;
  session.teamSize = 0;
  session.selection = { ...DEFAULT_SELECTION };
  session.playingId = '';
  session.vote = null;
  session.voteEndsAt = 0;
}

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
