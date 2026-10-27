import { cornerCenter } from '../../shared/geometry';
import { type BallArenaState } from '../../shared/types';
import { type OptionValue } from '../../../../core/shared/catalog';
import { CORE_DEFAULTS } from '../core/config';
import { clamp, r2 } from '../core/geometry';
import type { ArenaApi, VariantModule } from '../core/module';
import { numberOption } from '../core/options';
import type { Ball } from '../core/types';
import { nextIn } from '../../../../core/shared/kit/util';
import type { VariantConfig } from './config';

/**
 * Cloud Orbs: every `every` s (randomized) `count` corner engines fail for
 * `duration` s and drag every ball toward them with `pull` px/s^2.
 */
export interface EnginesConfig {
  every: number;
  /** +- s on `every` */
  variance: number;
  duration: number;
  /** +- s on `duration` */
  durationVariance: number;
  pull: number;
  count: number;
}

export const cloudOrbs: VariantConfig = {
  ...CORE_DEFAULTS,
  id: 'cloud-orbs',
  name: 'Cloud Orbs',
  ballRadius: 20,
  ballSpeed: 340,
  ballMaxSpeed: 720,
  ballMinSpeed: 220,
  hitGain: 1.04,
  paddleLen: 100,
  engines: { every: 15, variance: 7.5, duration: 6, durationVariance: 0, pull: 700, count: 1 },
};

export function applyEngineOptions(cfg: VariantConfig, options: Record<string, OptionValue>): void {
  const num = numberOption(options);
  if (cfg.engines) {
    if (options.failEnabled === false) delete cfg.engines;
    else {
      cfg.engines.every = num('failEvery', 5, 120) ?? cfg.engines.every;
      cfg.engines.variance = num('failVariance', 0, 60) ?? cfg.engines.variance;
      cfg.engines.duration = num('failDuration', 2, 30) ?? cfg.engines.duration;
      cfg.engines.durationVariance = num('failDurationVariance', 0, 10) ?? cfg.engines.durationVariance;
      cfg.engines.pull = num('failPull', 100, 2000) ?? cfg.engines.pull;
      cfg.engines.count = Math.round(num('failCount', 1, 3) ?? cfg.engines.count);
    }
  }
}

/** seconds of warning before an engine fails */
export const ENGINE_WARN = 1.5;
/** pull strength change per second (it ramps in/out in 0.5 s) */
export const ENGINE_RAMP = 2;

interface Engine {
  phase: 'ok' | 'warn' | 'fail';
  t: number;
  /** length of the current failure, the 100 % of the snapshot's `left` */
  total: number;
  ramp: number;
}

/** The four corner engines: failures drag balls toward the failing corner. */
export class EnginesModule implements VariantModule {
  readonly id = 'engines';
  private engines: Engine[] = [];
  private wait = 0;
  private lastFailed: number[] = [];

  constructor(
    private readonly api: ArenaApi,
    private readonly c: EnginesConfig,
  ) {}

  /** Seconds until the next failure: every +- variance. */
  private jitter(): number {
    return nextIn(this.api.rand, this.c.every, this.c.variance, 1);
  }

  init(): void {
    this.engines = [0, 1, 2, 3].map(() => ({ phase: 'ok' as const, t: 0, total: 1, ramp: 0 }));
    this.lastFailed = [];
    this.wait = this.jitter();
  }

  update(dt: number): void {
    const { c, api } = this;
    let active = false;
    this.engines.forEach((en, i) => {
      if (en.phase === 'warn') {
        en.t -= dt;
        if (en.t <= 0) {
          en.phase = 'fail';
          en.t = en.total = nextIn(api.rand, c.duration, c.durationVariance, 1);
        }
      } else if (en.phase === 'fail') {
        en.t -= dt;
        if (en.t <= 0) {
          en.phase = 'ok';
          en.t = 0;
          const [x, y] = cornerCenter(i);
          api.emit('engine', `${i}:ok`, x, y);
          if (this.engines.every((o) => o.phase === 'ok')) this.wait = this.jitter();
        }
      }
      // pull ramps in while failing and out otherwise
      const target = en.phase === 'fail' ? 1 : 0;
      en.ramp = clamp(en.ramp + Math.sign(target - en.ramp) * ENGINE_RAMP * dt, 0, 1);
      if (Math.abs(en.ramp - target) < ENGINE_RAMP * dt) en.ramp = target;
      if (en.phase !== 'ok') active = true;
    });
    if (active) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    // pick `count` distinct engines, preferring ones that did not just fail
    const all = [0, 1, 2, 3];
    const fresh = all.filter((i) => !this.lastFailed.includes(i));
    const pool = fresh.length >= c.count ? fresh : all;
    const picked: number[] = [];
    while (picked.length < Math.min(c.count, pool.length)) {
      const k = pool[Math.floor(api.rand() * pool.length)];
      if (!picked.includes(k)) picked.push(k);
    }
    this.lastFailed = picked;
    for (const i of picked) {
      this.engines[i].phase = 'warn';
      this.engines[i].t = ENGINE_WARN;
      const [x, y] = cornerCenter(i);
      api.emit('engine', `${i}:fail`, x, y);
    }
  }

  /** Failing engines drag every free ball toward them. */
  forceBall(b: Ball, dt: number): void {
    for (let i = 0; i < 4; i++) {
      const en = this.engines[i];
      if (!en || en.ramp <= 0) continue;
      const [ex, ey] = cornerCenter(i);
      const dx = ex - b.x;
      const dy = ey - b.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) continue;
      const a = this.c.pull * en.ramp * dt;
      b.vx += (dx / d) * a;
      b.vy += (dy / d) * a;
    }
  }

  extendState(state: BallArenaState): void {
    state.engines = this.engines.map((en) => ({
      phase: en.phase,
      left: en.phase === 'warn' ? r2(en.t / ENGINE_WARN) : en.phase === 'fail' ? r2(en.t / en.total) : 0,
      pull: r2(en.ramp),
    }));
  }
}
