import { rotQuarter } from '../../shared/geometry';
import { type BallArenaState } from '../../shared/types';
import { type OptionValue } from '../../../../core/shared/catalog';
import { CORE_DEFAULTS } from '../core/config';
import { C, H, MAX_ANGLE, PADDLE_SPEED, PADDLE_T, clamp, r1, r2 } from '../core/geometry';
import type { ArenaApi, VariantModule } from '../core/module';
import { numberOption } from '../core/options';
import type { Ball, Paddle } from '../core/types';
import type { VariantConfig } from './config';

/**
 * Sand Orb: the action button is a magnet. Hold to pull balls in, they stick
 * to the paddle (up to `capacity`); release = boosted launch, holding longer
 * than `holdTime` releases them without boost. `cooldown` before re-use (0 = none).
 * The second button is the usual kick (smash).
 */
export interface MagnetConfig {
  capacity: number;
  holdTime: number;
  cooldown: number;
  pullRange: number;
  pullAccel: number;
  /** speed multiplier of a plain (unboosted) release, on top of `hitGain` */
  releaseGain: number;
}

export const sandOrb: VariantConfig = {
  ...CORE_DEFAULTS,
  id: 'sand-orb',
  name: 'Sand Orb',
  lives: 7,
  ballSpeed: 250,
  ballMaxSpeed: 440,
  ballMinSpeed: 120,
  hitGain: 1.03,
  drag: 0.35,
  paddleLen: 180,
  smashButton: 'a2', // the first button is the magnet; the kick (smash) is the second action
  spawn: { delay: 3, variance: 1.2 },
  startBalls: () => 1,
  magnet: { capacity: 2, holdTime: 3, cooldown: 0, pullRange: 140, pullAccel: 1800, releaseGain: 1.3 },
};

export function applyMagnetOptions(cfg: VariantConfig, options: Record<string, OptionValue>): void {
  if (!cfg.magnet) return;
  const num = numberOption(options);
  cfg.magnet.capacity = Math.round(num('magnetCapacity', 1, 4) ?? cfg.magnet.capacity);
  cfg.magnet.holdTime = num('holdTime', 1, 8) ?? cfg.magnet.holdTime;
  cfg.magnet.cooldown = num('magnetCooldown', 0, 6) ?? cfg.magnet.cooldown;
  cfg.magnet.pullRange = num('pullRange', 60, 400) ?? cfg.magnet.pullRange;
}

interface Slot {
  ball: Ball;
  /** speed it had when caught; the launch speed is derived from it */
  speed: number;
}

interface PaddleMagnet {
  /** button held with a free slot */
  pulling: boolean;
  pullT: number;
  held: Slot[];
  holdT: number;
  cd: number;
  /** after a timeout release the button must be let go before pulling again */
  lockout: boolean;
}

export class MagnetModule implements VariantModule {
  readonly id = 'magnet';
  private state = new Map<string, PaddleMagnet>();

  constructor(
    private readonly api: ArenaApi,
    private readonly m: MagnetConfig,
  ) {}

  private of(p: Paddle): PaddleMagnet {
    let s = this.state.get(p.id);
    if (!s) {
      s = { pulling: false, pullT: 0, held: [], holdT: 0, cd: 0, lockout: false };
      this.state.set(p.id, s);
    }
    return s;
  }

  init(): void {
    this.state.clear();
  }

  stepPaddle(p: Paddle, dt: number): void {
    const m = this.m;
    const s = this.of(p);
    const a1 = p.input.a1;
    if (!a1) s.lockout = false;

    if (s.held.length > 0) {
      s.holdT -= dt;
      if (!a1) {
        this.release(p, s, true); // let go -> boosted launch
        s.cd = m.cooldown;
      } else if (s.holdT <= 0) {
        this.release(p, s, false); // held too long -> plain release
        s.lockout = true;
        s.cd = m.cooldown;
      }
      s.pulling = a1 && s.held.length > 0 && s.held.length < m.capacity;
      return;
    }

    if (!s.pulling) s.cd = Math.max(0, s.cd - dt);
    const canPull = a1 && !s.lockout && s.cd <= 0;
    if (canPull) {
      if (!s.pulling) {
        s.pulling = true;
        s.pullT = 0;
      }
      s.pullT += dt;
      if (s.pullT >= m.holdTime) {
        // pulled for the whole window and caught nothing: cool down
        s.pulling = false;
        s.lockout = true;
        s.cd = m.cooldown;
      }
    } else if (s.pulling) {
      s.pulling = false;
      s.cd = Math.min(m.cooldown, 0.4);
    }
  }

  afterPaddles(): void {
    for (const p of this.api.paddles) this.positionHeld(p, this.of(p));
  }

  /** Pull free balls that are close in front of a pulling paddle. */
  forceBall(b: Ball, dt: number): void {
    const r = this.api.cfg.ballRadius;
    for (const p of this.api.paddles) {
      const s = this.of(p);
      if (!p.alive || !s.pulling || s.held.length >= this.m.capacity) continue;
      const [px, py] = rotQuarter(b.x - C, b.y - C, 4 - p.side);
      const tx = p.pos;
      const ty = H - PADDLE_T - r;
      const dx = tx - px;
      const dy = ty - py;
      const dist = Math.hypot(dx, dy);
      if (dist > this.m.pullRange || dist < 1e-3 || py > ty + r) continue;
      const [ax, ay] = rotQuarter((dx / dist) * this.m.pullAccel, (dy / dist) * this.m.pullAccel, p.side);
      b.vx += ax * dt;
      b.vy += ay * dt;
      const damp = Math.exp(-1.5 * dt);
      b.vx *= damp;
      b.vy *= damp;
    }
  }

  /** A ball reached a pulling paddle with a free slot: it sticks instead of bouncing. */
  paddleContact(b: Ball, pad: Paddle, speed: number): boolean {
    const s = this.of(pad);
    if (!s.pulling || s.held.length >= this.m.capacity) return false;
    if (s.held.length === 0) s.holdT = this.m.holdTime;
    b.held = true;
    b.vx = b.vy = 0;
    s.held.push({ ball: b, speed });
    if (s.held.length >= this.m.capacity) s.pulling = false;
    this.positionHeld(pad, s);
    this.api.emit('catch', pad.id, b.x, b.y);
    return true;
  }

  /** Paddle gone while holding: the balls go back into play from a corner. */
  paddleGone(p: Paddle): void {
    const s = this.of(p);
    for (const slot of s.held) this.api.requeue(slot.ball);
    s.held = [];
    s.pulling = false;
  }

  cooldownFraction(p: Paddle): number | undefined {
    const s = this.of(p);
    // no magnet cooldown running: leave the bar to the kick's cooldown
    if (s.cd <= 0 || this.m.cooldown <= 0) return undefined;
    return r2(1 - s.cd / this.m.cooldown);
  }

  extendState(state: BallArenaState): void {
    const held: number[] = [];
    state.magnet = {
      range: this.m.pullRange,
      paddles: this.api.paddles.map((p) => {
        const s = this.of(p);
        for (const slot of s.held) held.push(slot.ball.id);
        return {
          id: p.id,
          pulling: s.pulling,
          held: s.held.length,
          holdLeft: s.held.length > 0 ? r2(Math.max(0, s.holdT) / this.m.holdTime) : -1,
        };
      }),
      held,
    };
  }

  private positionHeld(p: Paddle, s: PaddleMagnet): void {
    const n = s.held.length;
    if (n === 0) return;
    const r = this.api.cfg.ballRadius;
    s.held.forEach(({ ball }, i) => {
      const slot = p.pos + (i - (n - 1) / 2) * (2 * r * 0.95);
      const [wx, wy] = rotQuarter(slot, H - PADDLE_T - r, p.side);
      ball.x = C + wx;
      ball.y = C + wy;
    });
  }

  /** Launch every held ball away from the paddle, boosted or at plain speed. */
  private release(p: Paddle, s: PaddleMagnet, boosted: boolean): void {
    const { cfg, smashCeil } = this.api;
    const r = cfg.ballRadius;
    const n = s.held.length;
    s.held.forEach(({ ball: b, speed: caught }, i) => {
      const slot = (i - (n - 1) / 2) * (2 * r * 0.95);
      const aim = clamp((slot / (p.len / 2 + r)) * 0.7 + (p.vel / PADDLE_SPEED) * 0.4, -1, 1) * MAX_ANGLE;
      const base = Math.max(caught, cfg.ballMinSpeed, cfg.ballSpeed) * cfg.hitGain;
      let speed = Math.min(base * this.m.releaseGain, cfg.ballMaxSpeed);
      if (boosted) {
        speed = Math.min(cfg.ballMaxSpeed * smashCeil, base * cfg.smashGain);
        b.boost = 1;
      }
      const [wvx, wvy] = rotQuarter(Math.sin(aim) * speed, -Math.cos(aim) * speed, p.side);
      b.vx = wvx;
      b.vy = wvy;
      b.held = false;
      this.api.emit(boosted ? 'smash' : 'release', p.id, r1(b.x), r1(b.y));
    });
    s.held = [];
    s.pulling = false;
    s.holdT = 0;
  }
}
