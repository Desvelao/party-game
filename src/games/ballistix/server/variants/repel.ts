import { rotQuarter } from '../../shared/geometry';
import { type BallArenaState } from '../../shared/types';
import { type OptionValue } from '../../../../core/shared/catalog';
import { C, H, PADDLE_T, r2 } from '../core/geometry';
import type { ArenaApi, VariantModule } from '../core/module';
import { numberOption } from '../core/options';
import type { Paddle, Ball } from '../core/types';
import { nextIn } from '../../../../core/shared/kit/util';
import type { VariantConfig } from './config';

/**
 * Repulsion power-up (Pulse Ball): every `every` s (randomized) an item appears in a field corner. A paddle
 * that gets close takes it and, for `duration` s, pushes every ball within `radius` in front of it away.
 */
export interface RepelConfig {
  every: number;
  /** +- s on `every` */
  variance: number;
  /** seconds the effect stays on the paddle */
  duration: number;
  /** +- s on `duration` */
  durationVariance: number;
  /** reach in front of the paddle (px) */
  radius: number;
  /** push strength at the paddle (px/s^2); halves toward the edge of the radius */
  force: number;
  /** seconds the item waits in its corner before it vanishes */
  itemLife: number;
  /** +- s on `itemLife` */
  itemVariance: number;
}

export function applyRepelOptions(cfg: VariantConfig, options: Record<string, OptionValue>): void {
  if (!cfg.repel) return;
  if (options.repelEnabled === false) {
    delete cfg.repel;
    return;
  }
  const num = numberOption(options);
  cfg.repel.every = num('repelEvery', 10, 120) ?? cfg.repel.every;
  cfg.repel.variance = num('repelVariance', 0, 60) ?? cfg.repel.variance;
  cfg.repel.duration = num('repelDuration', 2, 30) ?? cfg.repel.duration;
  cfg.repel.durationVariance = num('repelDurationVariance', 0, 10) ?? cfg.repel.durationVariance;
  cfg.repel.radius = num('repelRadius', 60, 400) ?? cfg.repel.radius;
  cfg.repel.force = num('repelForce', 800, 6000) ?? cfg.repel.force;
  cfg.repel.itemLife = num('repelItemLife', 5, 60) ?? cfg.repel.itemLife;
  cfg.repel.itemVariance = num('repelItemVariance', 0, 20) ?? cfg.repel.itemVariance;
}

/** Distance from the field centre, per axis, of the item in its corner (just inside the launcher block). */
const ITEM_OFFSET = 316;
/** How close a paddle's rectangle must get to the item to take it (px). */
const PICK_REACH = 72;

interface Item {
  x: number;
  y: number;
  corner: number;
  left: number;
  /** how long it was given to wait (the 100 % of the snapshot's `life`) */
  total: number;
}

export class RepelModule implements VariantModule {
  readonly id = 'repel';
  private item: Item | null = null;
  private wait = 0;
  private lastCorner = -1;
  /** player id -> seconds left, and the length it was given (the 100 % of the snapshot's `left`) */
  private effect = new Map<string, { left: number; total: number }>();

  constructor(
    private readonly api: ArenaApi,
    private readonly r: RepelConfig,
  ) {}

  private nextWait(): number {
    return nextIn(this.api.rand, this.r.every, this.r.variance, 1);
  }

  init(): void {
    this.item = null;
    this.effect.clear();
    this.lastCorner = -1;
    this.wait = this.nextWait();
  }

  update(dt: number): void {
    for (const [id, e] of this.effect) {
      e.left -= dt;
      if (e.left <= 0) this.effect.delete(id);
    }
    if (this.item) {
      this.item.left -= dt;
      if (this.item.left <= 0) {
        this.item = null;
        this.wait = this.nextWait();
      }
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    const choices = [0, 1, 2, 3].filter((c) => c !== this.lastCorner);
    const corner = choices[Math.floor(this.api.rand() * choices.length)];
    this.lastCorner = corner;
    const sx = corner === 1 || corner === 2 ? 1 : -1;
    const sy = corner >= 2 ? 1 : -1;
    const itemLife = nextIn(this.api.rand, this.r.itemLife, this.r.itemVariance, 1);
    this.item = { x: C + sx * ITEM_OFFSET, y: C + sy * ITEM_OFFSET, corner, left: itemLife, total: itemLife };
    this.api.emit('spawn', '', this.item.x, this.item.y);
  }

  afterPaddles(): void {
    const it = this.item;
    if (!it) return;
    for (const p of this.api.paddles) {
      if (!p.alive || !this.reaches(p, it)) continue;
      const total = nextIn(this.api.rand, this.r.duration, this.r.durationVariance, 1);
      this.effect.set(p.id, { left: total, total });
      this.item = null;
      this.wait = this.nextWait();
      const [fx, fy] = this.face(p);
      this.api.emit('pickup', p.id, fx, fy);
      return;
    }
  }

  /** Paddle rectangle (side frame) to item distance within reach. */
  private reaches(p: Paddle, it: Item): boolean {
    const [px, py] = rotQuarter(it.x - C, it.y - C, 4 - p.side);
    const dx = Math.max(Math.abs(px - p.pos) - p.len / 2, 0);
    const dy = Math.max(py - H, H - PADDLE_T - py, 0);
    return Math.hypot(dx, dy) <= PICK_REACH;
  }

  private face(p: Paddle): [number, number] {
    const [x, y] = rotQuarter(p.pos, H - PADDLE_T / 2, p.side);
    return [C + x, C + y];
  }

  forceBall(b: Ball, dt: number): void {
    if (this.effect.size === 0) return;
    for (const p of this.api.paddles) {
      if (!p.alive || !this.effect.has(p.id)) continue;
      // field side only: nothing behind the goal line
      const [, depth] = rotQuarter(b.x - C, b.y - C, 4 - p.side);
      if (depth > H - PADDLE_T / 2) continue;
      const [fx, fy] = this.face(p);
      const dx = b.x - fx;
      const dy = b.y - fy;
      const dist = Math.hypot(dx, dy);
      if (dist > this.r.radius || dist < 1e-3) continue;
      const a = this.r.force * (1 - 0.5 * (dist / this.r.radius)) * dt;
      b.vx += (dx / dist) * a;
      b.vy += (dy / dist) * a;
    }
  }

  paddleGone(p: Paddle): void {
    this.effect.delete(p.id);
  }

  extendState(state: BallArenaState): void {
    state.repel = {
      item: this.item ? { x: this.item.x, y: this.item.y, life: r2(Math.max(0, this.item.left) / this.item.total) } : null,
      paddles: [...this.effect].map(([id, e]) => ({ id, left: r2(e.left / e.total) })),
      radius: this.r.radius,
    };
  }
}
