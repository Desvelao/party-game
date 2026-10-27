/**
 * Contract of the client half of a game pack (`client.mjs`, default export: ClientGamePlugin).
 * Types only: pack authors import them, and the bundle keeps no runtime reference. Everything a
 * pack may use at runtime arrives through `ClientContext` and `RenderHost`, so a pack never
 * imports Phaser or the core.
 */
import type Phaser from 'phaser';
import type { CharacterDraw, GameEvent, GameState, Localized, MessageKey, MoveControl } from '../../../shared';
import type { MusicTrack } from '../audio/music';
import type { SoundStep } from '../audio/recipe';
import type { SfxName } from '../audio/sfx';
import type { Fx, RenderHost } from '../scenes/host';

export type { Fx, MoveControl, MusicTrack, RenderHost, SfxName, SoundStep };

export interface RankEntry {
  id: string;
  alive: boolean;
  /** short status next to the name (points, hit points, lap...) */
  text: string;
}

export interface ClientContext {
  /** core UI strings (`hud.pts`, `hud.hp`...); for a pack's own texts use `tr` or `loc` */
  t(key: MessageKey, params?: Record<string, string | number>): string;
  /** translate an English sentence the pack ships a text for (`locales` in game.json) */
  tr(english: string): string;
  loc(text: Localized): string;
  /** display name of a playable id */
  variantName(id: string): string;
  /** the player this screen belongs to ('' for spectators) */
  myId(): string;
  /** the colour (0xRRGGBB) a player chose */
  colorOf(id: string): number;
  /** the name shown for a player (with the marker option applied) */
  labelOf(id: string): string;
  /**
   * draw a player's character centred on x, y with radius r, facing `facing` radians: the model named by `character` in
   * game.json, with the player's look of it and their colour (a plain body when the game names none)
   */
  drawCharacter(g: Phaser.GameObjects.Graphics, id: string, x: number, y: number, r: number, facing: number): void;
  /** how much ambient motion to play: 0 (none), 0.4 (low) or 1, from the player's motion setting and the OS reduced-motion flag; scale decorative movement by it */
  motion(): number;
  lerp(a: number, b: number, t: number): number;
  clamp(v: number, lo: number, hi: number): number;
  sfx(name: SfxName): void;
  /** play the pack's own short synth sound, given as data (see `SoundStep`): at most 10 voices, each checked and limited */
  sound(steps: SoundStep[]): void;
  /** flash a big message in the middle of the arena for a moment (lap done, round point...) */
  big(text: string): void;
  /** send a game-defined message to the server (the game's `handleAction`): a small plain JSON object, at most ~500 bytes */
  send(data: Record<string, unknown>): void;
}

/** A pack's own phone controls, mounted for players (never spectators) instead of the joystick and buttons. */
export interface ControllerHandle {
  /** `pub`: the latest public snapshot; `priv`: this player's private state (`getPrivateState`), null when there is none yet. */
  update(pub: GameState | null, priv: unknown): void;
  destroy(): void;
}

export interface GameRenderer {
  /** Draw one frame on `host.g` (cleared every frame) from the two snapshots around render time. */
  render(host: RenderHost, a: GameState, b: GameState, latest: GameState, alpha: number): void;
  /** A new round starts: drop anything remembered between frames. */
  reset?(): void;
  /** The player was eliminated: draw them as fallen from now on. */
  markFallen?(id: string): void;
}

export interface ClientGamePlugin {
  /** The `state.kind` values this plugin draws (`ext:...`). */
  kinds: string[];
  createRenderer(ctx: ClientContext): GameRenderer;
  /** Status line at the top of the arena; return null to show nothing special. */
  hud?(state: GameState, ctx: ClientContext): string | null;
  /** Called every frame while playing, to react to state changes that have no server event (laps, warnings). */
  cue?(state: GameState, phase: 'countdown' | 'playing', ctx: ClientContext): void;
  /** React to an event with sound and effects. Return true when handled; false falls back to the core's generic effects. */
  event?(e: GameEvent, fx: Fx, ctx: ClientContext): boolean;
  /** Live standings for spectators, best first. */
  ranking?(state: GameState, ctx: ClientContext): RankEntry[];
  /** Move control that suits the running game (e.g. a cross for grid movement). */
  moveControl?(state: GameState): MoveControl | undefined;
  /** Custom controls drawn in `el` (cards, buttons...) instead of the joystick; the core hides its own controls while it is mounted. */
  controller?(el: HTMLElement, ctx: ClientContext): ControllerHandle;
  /** Texts for the action buttons (A, and B when `a2` is given), e.g. `Play` / `End turn`; undefined keeps the catalog's labels. */
  actionLabels?(state: GameState, ctx: ClientContext): { a1: string; a2?: string } | undefined;
  /** Keep the joystick/cross and action buttons on screen while the `controller` is mounted (it is drawn above them). */
  controllerKeepsControls?: boolean;
  /** A DOM layer over the arena for everyone, spectators included (cards, scoreboards...). Drawn in `el`; `priv` is always null here. Touches pass through it to the canvas. */
  overlay?(el: HTMLElement, ctx: ClientContext): ControllerHandle;
  /** Background music of the whole game (all its variants). */
  music?: MusicTrack;
  /** How the character models this pack declares in `characters` of game.json are drawn, by model id. */
  characters?: Record<string, CharacterDraw>;
}
