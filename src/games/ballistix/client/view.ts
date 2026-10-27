import type { GameEvent } from '../../../core/shared/types';
import type { ClientContext, Fx } from '../../../core/client/src/plugins/api';
import type { Frame, Warp } from './frame';
import type { BallArenaState } from '../shared/types';

export type BallStyle = Partial<{ color: number; alpha: number; outlineColor: number; outlineWidth: number }>;

/**
 * How one variant feature looks. The core renderer calls every registered view
 * at fixed points; a view reads its own part of the state (`state.magnet`,
 * `state.enemy`, ...) and does nothing when that part is absent. All hooks are
 * optional.
 */
export interface BallistixView {
  readonly id: string;
  /** Distort the field for this frame (a platform that floats or sags); `turn` is the viewer's quarter turns, `motion` the ambient motion allowed (0..1). */
  warp?(s: BallArenaState, a: BallArenaState, b: BallArenaState, alpha: number, now: number, turn: number, motion: number): Warp | null;
  /** Draw behind the field and its shadow (sky, clouds). */
  backdrop?(f: Frame): void;
  /**
   * Draw this corner's contents instead of the plain launcher barrel; return true if drawn. `x`,`y` is the corner's
   * launcher point fixed in the air (not warped), `deckX`,`deckY` the same point on the deck, which may have dropped.
   */
  corner?(f: Frame, index: number, x: number, y: number, half: number, deckX: number, deckY: number): boolean;
  /** Draw in the field, after the corner blocks and before the paddles. */
  world?(f: Frame): void;
  /** Under a paddle (e.g. an effect field). `pos` is the interpolated position. */
  paddleUnder?(f: Frame, p: Frame['s']['paddles'][number], pos: number): void;
  /** On top of a paddle's fill. */
  paddleOver?(f: Frame, p: Frame['s']['paddles'][number], pos: number): void;
  /** Override how a ball is drawn. */
  ballStyle?(f: Frame, ball: Frame['s']['balls'][number]): BallStyle | undefined;
  /** React to a variant-specific event; return true when handled. */
  handleEvent?(e: GameEvent, fx: Fx, ctx: ClientContext): boolean;
}
