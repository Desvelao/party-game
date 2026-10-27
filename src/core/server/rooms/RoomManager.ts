import { DEFAULT_SELECTION, describeSelection, type GameSelection, type RoomPhase } from '../../shared';
import type { ServerConfig } from '../config';
import { Room, type RoomHooks, type RoomSnapshot } from './Room';
import { generateRoomCode } from './codes';

export interface RoomSummary {
  code: string;
  game: string;
  phase: RoomPhase;
  /** `open` while new players can still join, `playing` otherwise. */
  status: 'open' | 'playing';
  players: number;
  maxPlayers: number;
  spectators: number;
  locked: boolean;
  passwordProtected: boolean;
  /** listed in the public room browser */
  public: boolean;
  /** connected people, apart from virtual players such as bots */
  humans: number;
  /** what installed plugins add to the entry, by plugin id */
  ext?: Record<string, unknown>;
}

export type RoomEvent = 'created' | 'changed' | 'closed';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private listeners: Record<RoomEvent, Set<(room: Room) => void>> = { created: new Set(), changed: new Set(), closed: new Set() };
  /** rooms updated since the last tick: plugins hear about each once per tick, never from inside the update that changed it */
  private dirty = new Set<Room>();
  /** adds plugin data to a room's list entry (set by the plugin registry) */
  summarize: (room: Room) => Record<string, unknown> | undefined = () => undefined;
  private readonly hooks: RoomHooks;

  constructor(
    private readonly cfg: ServerConfig,
    hooks: RoomHooks = {},
  ) {
    this.hooks = { ...hooks, changed: (room) => void this.dirty.add(room) };
  }

  /** Listen to room events; returns the function that stops listening. */
  on(event: RoomEvent, fn: (room: Room) => void): () => void {
    this.listeners[event].add(fn);
    return () => void this.listeners[event].delete(fn);
  }

  private emit(event: RoomEvent, room: Room): void {
    for (const fn of this.listeners[event]) {
      try {
        fn(room);
      } catch (err) {
        console.error(`[party-game] room ${event} listener failed`, err);
      }
    }
  }

  private extOf(room: Room): { ext?: Record<string, unknown> } {
    const ext = this.summarize(room);
    return ext && Object.keys(ext).length > 0 ? { ext } : {};
  }

  private forget(room: Room): void {
    this.rooms.delete(room.code);
    this.dirty.delete(room);
    this.emit('closed', room);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => ({
      code: r.code,
      game: describeSelection(r.selection),
      phase: r.phase,
      status: r.phase === 'lobby' && !r.locked && r.size < r.maxPlayers ? 'open' : 'playing',
      players: r.connectedCount,
      maxPlayers: r.maxPlayers,
      spectators: r.spectatorCount,
      locked: r.locked,
      passwordProtected: r.passwordProtected,
      public: r.isPublic,
      humans: r.connectedHumans,
      ...this.extOf(r),
    }));
  }

  /**
   * After the operator changed what is allowed: lobbies (and finished rooms) whose selection is now refused
   * go back to the default mix, and the players are told. Rooms in a match are left; play-time skips disabled rounds.
   * Returns the codes that changed.
   */
  revalidate(check: (sel: GameSelection) => string | null): string[] {
    const changed: string[] = [];
    for (const room of this.rooms.values()) {
      if (!room.canResetSelection || !check(room.selection)) continue;
      room.adminResetSelection();
      room.adminCodedNotice('SELECTION_RESET', 'The game was changed by an administrator');
      changed.push(room.code);
    }
    return changed;
  }

  /** Operator close: players and watchers get ROOM_CLOSED. False when there is no such room. */
  closeRoom(code: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    room.close();
    this.forget(room);
    return true;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Returns null when the server is at its room limit. */
  create(selection: GameSelection = DEFAULT_SELECTION, password?: string, isPublic = false): Room | null {
    if (this.rooms.size >= this.cfg.maxRooms) return null;
    const code = generateRoomCode((c) => this.rooms.has(c));
    // a selection that names a disabled game falls back to the default mix
    if (this.hooks.checkSelection?.(selection)) selection = DEFAULT_SELECTION;
    const room = new Room(code, this.cfg, selection, this.hooks);
    if (password) room.setPassword(password);
    room.isPublic = isPublic;
    this.rooms.set(code, room);
    this.emit('created', room);
    return room;
  }

  /** The lobbies worth keeping across a restart. */
  snapshots(): RoomSnapshot[] {
    const out: RoomSnapshot[] = [];
    for (const room of this.rooms.values()) {
      const s = room.persistable();
      if (s) out.push(s);
    }
    return out;
  }

  /** Bring saved lobbies back under their old codes (at startup); returns how many came back. */
  restore(saved: RoomSnapshot[]): number {
    let n = 0;
    for (const s of saved) {
      if (this.rooms.size >= this.cfg.maxRooms) break;
      if (this.rooms.has(s.code)) continue;
      // an operator may have switched the game off meanwhile
      const selection = this.hooks.checkSelection?.(s.selection) ? DEFAULT_SELECTION : s.selection;
      const room = new Room(s.code, this.cfg, selection, this.hooks);
      room.applySnapshot(s);
      this.rooms.set(s.code, room);
      this.emit('created', room);
      n++;
    }
    return n;
  }

  /** Drop a room once no player is connected (spectators alone don't keep it alive). */
  releaseIfEmpty(room: Room): void {
    if (room.connectedHumans === 0 && !room.hasResumable() && !room.screenConnected && !room.controllerConnected) {
      room.close();
      this.forget(room);
    }
  }

  update(dt: number): void {
    if (this.dirty.size > 0) {
      const changed = [...this.dirty];
      this.dirty.clear();
      for (const room of changed) if (this.rooms.has(room.code)) this.emit('changed', room);
    }
    for (const room of this.rooms.values()) {
      try {
        room.update(dt);
        if (room.size > 0 && room.connectedHumans === 0 && !room.hasResumable()) {
          // everyone dropped and nobody can come back any more
          room.close();
          this.forget(room);
          continue;
        }
        if (this.cfg.idleRoomSeconds > 0 && room.idleSeconds >= this.cfg.idleRoomSeconds && !room.screenConnected) {
          // notifies connected players/spectators with ROOM_CLOSED
          room.close();
          this.forget(room);
        }
      } catch (err) {
        // one broken room must not take down the loop or the other rooms
        console.error(`[party-game] room ${room.code} update failed; closing it`, err);
        try {
          room.close();
        } catch (closeErr) {
          console.error(`[party-game] room ${room.code} close failed`, closeErr);
        }
        this.forget(room);
      }
    }
  }
}
