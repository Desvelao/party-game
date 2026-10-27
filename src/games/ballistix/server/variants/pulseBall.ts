import type { BallArenaState } from '../../shared/types';
import type { OptionValue } from '../../../../core/shared/catalog';
import { CORE_DEFAULTS } from '../core/config';
import { C, r2 } from '../core/geometry';
import type { ArenaApi, VariantModule } from '../core/module';
import { numberOption } from '../core/options';
import { nextIn } from '../../../../core/shared/kit/util';
import type { Circle } from '../core/types';
import type { VariantConfig } from './config';

/**
 * Pulse Ball: a bot appears in the middle every `every` s (randomized), stays
 * `duration` s, spins in a random direction at ~`spin` rad/s and fires `rate`
 * balls per second at `ballSpeed` px/s.
 */
export interface EnemyConfig {
  every: number;
  /** +- s on `every` */
  variance: number;
  duration: number;
  /** +- s on `duration` */
  durationVariance: number;
  rate: number;
  ballSpeed: number;
  spin: number;
}

export const pulseBall: VariantConfig = {
  ...CORE_DEFAULTS,
  id: 'pulse-ball',
  name: 'Pulse Ball',
  enemy: { every: 20, variance: 10, duration: 8, durationVariance: 0, rate: 1.5, ballSpeed: 360, spin: 1.6 },
  repel: { every: 25, variance: 12.5, duration: 8, durationVariance: 0, radius: 140, force: 2400, itemLife: 20, itemVariance: 0 },
};

export function applyEnemyOptions(cfg: VariantConfig, options: Record<string, OptionValue>): void {
  if (!cfg.enemy) return;
  if (options.enemyEnabled === false) {
    delete cfg.enemy;
    return;
  }
  const num = numberOption(options);
  cfg.enemy.every = num('enemyEvery', 5, 120) ?? cfg.enemy.every;
  cfg.enemy.variance = num('enemyVariance', 0, 60) ?? cfg.enemy.variance;
  cfg.enemy.duration = num('enemyDuration', 2, 30) ?? cfg.enemy.duration;
  cfg.enemy.durationVariance = num('enemyDurationVariance', 0, 10) ?? cfg.enemy.durationVariance;
  cfg.enemy.rate = num('enemyRate', 0.5, 8) ?? cfg.enemy.rate;
  cfg.enemy.ballSpeed = num('enemyBallSpeed', 150, 800) ?? cfg.enemy.ballSpeed;
  cfg.enemy.spin = num('enemySpin', 0.3, 5) ?? cfg.enemy.spin;
}

const ENEMY_R = 46;
const ENEMY_WARN = 1.5; // seconds of warning before it starts firing
const ENEMY_BALL_LIFE = 12; // seconds an enemy ball lives at most
const ENEMY_BALL_CAP = 12; // concurrent enemy balls

export class EnemyModule implements VariantModule {
  readonly id = 'enemy';
  private phase: 'off' | 'warn' | 'on' = 'off';
  private t = 0;
  /** length of the current appearance (`duration` +- variance), the 100 % of the snapshot's `left` */
  private total = 1;
  private angle = 0;
  private dir = 1;
  private spin = 0;
  private fireT = 0;

  constructor(
    private readonly api: ArenaApi,
    private readonly e: EnemyConfig,
  ) {}

  /** Seconds until the next appearance: every +- variance. */
  private wait(): number {
    return nextIn(this.api.rand, this.e.every, this.e.variance, 1);
  }

  init(): void {
    this.phase = 'off';
    this.t = this.wait();
  }

  update(dt: number): void {
    const { e, api } = this;
    switch (this.phase) {
      case 'off':
        this.t -= dt;
        if (this.t <= 0) {
          this.phase = 'warn';
          this.t = ENEMY_WARN;
          this.angle = api.rand() * Math.PI * 2;
          this.dir = api.rand() < 0.5 ? -1 : 1; // random rotation direction
          this.spin = e.spin * (0.7 + 0.6 * api.rand());
          api.emit('enemy', '', C, C);
        }
        break;
      case 'warn':
        this.t -= dt;
        if (this.t <= 0) {
          this.phase = 'on';
          this.t = this.total = nextIn(api.rand, e.duration, e.durationVariance, 1);
          this.fireT = 0;
        }
        break;
      case 'on':
        this.t -= dt;
        this.angle += this.dir * this.spin * dt;
        this.fireT -= dt;
        while (this.fireT <= 0) {
          this.fire();
          this.fireT += 1 / e.rate;
        }
        if (this.t <= 0) {
          this.phase = 'off';
          this.t = this.wait();
          api.emit('enemy', '', C, C);
        }
        break;
    }
  }

  /** The body is solid while the bot is there (warning included). */
  obstacles(): Circle[] {
    return this.phase === 'off' ? [] : [{ x: C, y: C, r: ENEMY_R }];
  }

  extendState(state: BallArenaState): void {
    const mine = this.api.balls.filter((b) => b.disposable);
    state.enemy = {
      phase: this.phase,
      angle: Math.round(this.angle * 100) / 100,
      left:
        this.phase === 'warn'
          ? r2(this.t / ENEMY_WARN)
          : this.phase === 'on'
            ? r2(this.t / this.total)
            : 0,
      r: ENEMY_R,
      balls: mine.map((b) => ({ id: b.id, life: r2(Math.max(0, b.life) / ENEMY_BALL_LIFE) })),
    };
  }

  private fire(): void {
    const { api, e } = this;
    if (api.balls.reduce((n, b) => n + (b.disposable ? 1 : 0), 0) >= ENEMY_BALL_CAP) return;
    const r = api.cfg.ballRadius;
    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    const x = C + dx * (ENEMY_R + r + 2);
    const y = C + dy * (ENEMY_R + r + 2);
    api.addDisposableBall(x, y, dx * e.ballSpeed, dy * e.ballSpeed, ENEMY_BALL_LIFE);
    api.emit('spawn', '', x, y);
  }
}
