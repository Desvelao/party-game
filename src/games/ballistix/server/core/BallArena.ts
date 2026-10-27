import { CORNER_SIZE, cornerCenter, fieldCorner, rotQuarter } from '../../shared/geometry';
import { NO_INPUT, type GameEvent, type GameEventKind, type InputState } from '../../../../core/shared/types';
import { type BallArenaState } from '../../shared/types';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../../core/server/minigames/Minigame';
import { BALL_CEIL, smashCeilOf, type CoreConfig } from './config';
import {
  BOOST_DECAY,
  C,
  H,
  LAUNCH_SPREAD,
  MAX_ANGLE,
  PADDLE_RESPONSE,
  PADDLE_SPEED,
  PADDLE_T,
  SIDE_ORDER,
  PULSE_TIME,
  clamp,
  mulberry32,
  r1,
  r2,
} from './geometry';
import { nextIn } from '../../../../core/shared/kit/util';
import type { ArenaApi, ModuleFactory, VariantModule } from './module';
import { bounceCircle, bounceCorner, collideBalls } from './physics';
import type { Ball, Paddle, Side } from './types';

/** shortest wait before a ball launches / a reinforcement is queued, whatever the variance */
const SPAWN_MIN_GAP = 0.3;

/**
 * Core Ballistix rules, shared by every variant: a square field, one paddle
 * per player sliding along their side (the goal), balls launched from the
 * corner blocks, lives, smash (boost), reinforcement balls and ball-ball
 * collisions. Variant features plug in through `VariantModule` hooks; nothing
 * in here refers to a specific variant.
 */
export class BallArena implements Minigame {
  readonly id: string;
  readonly name: string;

  private paddles: Paddle[] = [];
  private byId = new Map<string, Paddle>();
  private sides: Side[] = [];
  private balls: Ball[] = [];
  private events: GameEvent[] = [];
  private t = 0;
  private nextBallId = 1;
  private elimCounter = 0;
  private usedSides = 0;
  private finished = false;
  private extraTimer = 0;
  private extraEvery = 0;
  private lastCorner = -1;
  private readonly rand: () => number;
  private readonly smashCeil: number;
  private readonly modules: VariantModule[];

  constructor(
    private readonly cfg: CoreConfig,
    makeModules: ModuleFactory = () => [],
    seed = (Math.random() * 2 ** 32) >>> 0,
  ) {
    // smashed-ball speed ceiling (x ballMaxSpeed) follows the boost multiplier
    this.smashCeil = smashCeilOf(cfg.smashGain);
    this.id = cfg.id;
    this.name = cfg.name;
    this.rand = mulberry32(seed);
    this.modules = makeModules(this.api());
  }

  /** The narrow view of the core that variant modules get. */
  private api(): ArenaApi {
    const self = this;
    return {
      cfg: this.cfg,
      get paddles() {
        return self.paddles;
      },
      get balls() {
        return self.balls;
      },
      smashCeil: this.smashCeil,
      rand: () => this.rand(),
      emit: (kind: GameEventKind, id: string, x: number, y: number) => this.events.push({ kind, id, x: r1(x), y: r1(y) }),
      addDisposableBall: (x, y, vx, vy, life) => {
        const b = this.newBall();
        Object.assign(b, { x, y, px: x, py: y, vx, vy, life, disposable: true });
        this.balls.push(b);
        return b;
      },
      requeue: (b) => this.queue(b),
    };
  }

  init(players: MinigamePlayer[]): void {
    const n = players.length;
    this.t = 0;
    this.finished = false;
    this.elimCounter = 0;
    this.events = [];
    this.balls = [];
    this.nextBallId = 1;
    this.extraTimer = 0;
    this.lastCorner = -1;
    this.extraEvery = this.jittered(this.cfg.reinforce.every, this.cfg.reinforce.variance);
    this.usedSides = Math.max(1, Math.min(4, n));
    this.sides = [0, 1, 2, 3].map(() => ({ used: false, alive: false, lives: 0, conceded: 0, elimOrder: 0 }));
    for (let i = 0; i < this.usedSides; i++) {
      const s = this.sides[SIDE_ORDER[i]];
      s.used = s.alive = true;
      s.lives = this.cfg.lives;
    }

    // players i -> side SIDE_ORDER[i % used], lane floor(i / used)
    const perSide = new Map<number, string[]>();
    players.forEach((p, i) => {
      const side = SIDE_ORDER[i % this.usedSides];
      perSide.set(side, [...(perSide.get(side) ?? []), p.id]);
    });
    this.paddles = [];
    this.byId.clear();
    for (const [side, ids] of perSide) {
      // goals only cover the stretch between the corner launcher blocks
      const span = H - CORNER_SIZE;
      const lane = (2 * span) / ids.length;
      ids.forEach((id, j) => {
        const laneL = -span + j * lane;
        const laneR = laneL + lane;
        const p: Paddle = {
          id,
          side,
          pos: (laneL + laneR) / 2,
          vel: 0,
          len: Math.min(this.cfg.paddleLen, lane * 0.8),
          laneL,
          laneR,
          alive: true,
          smashCd: 0,
          pulseT: 0,
          smashHeld: false,
          input: NO_INPUT,
        };
        this.paddles.push(p);
        this.byId.set(id, p);
      });
    }

    for (const m of this.modules) m.init?.();

    const count = this.cfg.startBalls(this.usedSides);
    for (let i = 0; i < count; i++) this.spawnBall();
  }

  handleInput(playerId: string, input: InputState): void {
    const p = this.byId.get(playerId);
    if (p) p.input = input;
  }

  removePlayer(playerId: string): void {
    const p = this.byId.get(playerId);
    if (!p || !p.alive) return;
    p.alive = false;
    p.input = NO_INPUT;
    for (const m of this.modules) m.paddleGone?.(p);
    const side = this.sides[p.side];
    if (side.alive && !this.paddles.some((q) => q.side === p.side && q.alive)) this.eliminateSide(p.side);
  }

  // ---- simulation ----------------------------------------------------------

  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;

    for (const m of this.modules) m.update?.(dt);
    for (const p of this.paddles) if (p.alive) this.stepPaddle(p, dt);
    for (const m of this.modules) m.afterPaddles?.();

    // reinforcements: another ball every so often, up to the maximum (0 = no maximum)
    this.extraTimer += dt;
    if (this.extraTimer >= this.extraEvery) {
      const { every, variance, max } = this.cfg.reinforce;
      this.extraTimer = 0;
      this.extraEvery = this.jittered(every, variance);
      const regular = this.balls.reduce((n, b) => n + (b.disposable ? 0 : 1), 0);
      if (max === 0 || regular < max) this.spawnBall();
    }

    for (const b of [...this.balls]) this.stepBall(b, dt);
    if (this.cfg.ballCollisions) {
      collideBalls(this.balls, this.cfg.ballRadius, dt, (k, id, x, y) => this.events.push({ kind: k, id, x, y }));
    }

    const alive = this.sides.filter((s) => s.used && s.alive).length;
    const lastStanding = this.usedSides > 1 ? alive <= 1 : alive === 0;
    if (lastStanding || this.t >= this.cfg.timeLimit) this.finished = true;
  }

  private stepPaddle(p: Paddle, dt: number): void {
    p.smashCd = Math.max(0, p.smashCd - dt);
    p.pulseT = Math.max(0, p.pulseT - dt);
    for (const m of this.modules) m.stepPaddle?.(p, dt);
    const target = clamp(p.input.mx, -1, 1) * PADDLE_SPEED;
    // the boost fires once per press (a held button does not repeat it)
    const down = !!p.input[this.cfg.smashButton];
    if (this.cfg.smashEnabled && down && !p.smashHeld && p.smashCd <= 0) this.pulse(p);
    p.smashHeld = down;
    p.vel += (target - p.vel) * Math.min(1, PADDLE_RESPONSE * dt);
    p.pos += p.vel * dt;
    const lo = p.laneL + p.len / 2;
    const hi = p.laneR - p.len / 2;
    if (p.pos < lo) {
      p.pos = lo;
      p.vel = 0;
    } else if (p.pos > hi) {
      p.pos = hi;
      p.vel = 0;
    }
  }

  /** Boost: shove every free ball within `smashRadius` in front of the paddle face away from it. */
  private pulse(p: Paddle): void {
    const cfg = this.cfg;
    const [lx, ly] = rotQuarter(p.pos, H - PADDLE_T / 2, p.side);
    const cx = C + lx;
    const cy = C + ly;
    p.smashCd = cfg.smashCooldown;
    p.pulseT = PULSE_TIME;
    for (const b of this.balls) {
      if (b.held || b.wait > 0) continue;
      // only the field side of the paddle: nothing happens behind the goal line
      const [, depth] = rotQuarter(b.x - C, b.y - C, 4 - p.side);
      if (depth > H - PADDLE_T / 2) continue;
      const dx = b.x - cx;
      const dy = b.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > cfg.smashRadius) continue;
      // straight out from the paddle; a ball exactly on it goes into the field
      const [nx, ny] = dist > 1e-3 ? [dx / dist, dy / dist] : rotQuarter(0, -1, p.side);
      const falloff = 1 - 0.5 * (dist / cfg.smashRadius);
      const speed = Math.hypot(b.vx, b.vy);
      const next = Math.min(
        cfg.ballMaxSpeed * this.smashCeil,
        Math.max(speed, cfg.ballSpeed) * (1 + (cfg.smashGain - 1) * falloff),
      );
      b.vx = nx * next;
      b.vy = ny * next;
      b.boost = 1;
    }
    this.events.push({ kind: 'smash', id: p.id, x: r1(cx), y: r1(cy) });
  }

  private stepBall(b: Ball, dt: number): void {
    const cfg = this.cfg;
    if (b.held) return; // a variant module has it: positioned by the module
    if (b.disposable) {
      b.life -= dt;
      if (b.life <= 0) {
        this.removeBall(b);
        return;
      }
    }
    if (b.wait > 0) {
      b.wait -= dt;
      if (b.wait <= 0) this.serve(b);
      return;
    }

    for (const m of this.modules) m.forceBall?.(b, dt);
    if (cfg.drag > 0) {
      const d = Math.exp(-cfg.drag * dt);
      b.vx *= d;
      b.vy *= d;
    }
    if (b.boost > 0) b.boost = Math.max(0, b.boost - dt / BOOST_DECAY);
    const speed = Math.hypot(b.vx, b.vy);
    // a smashed ball may exceed the normal ceiling, easing back as the boost fades
    const max = cfg.ballMaxSpeed * (BALL_CEIL + (this.smashCeil - BALL_CEIL) * b.boost);
    if (speed > max) {
      b.vx *= max / speed;
      b.vy *= max / speed;
    } else if (speed < cfg.ballMinSpeed && speed > 1e-6) {
      b.vx *= cfg.ballMinSpeed / speed;
      b.vy *= cfg.ballMinSpeed / speed;
    }
    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    const emit = (k: GameEventKind, id: string, x: number, y: number) => this.events.push({ kind: k, id, x, y });
    for (const m of this.modules) {
      for (const c of m.obstacles?.() ?? []) bounceCircle(b, c, cfg.ballRadius, cfg.ballMaxSpeed, emit);
    }
    for (let i = 0; i < 4; i++) bounceCorner(b, i, cfg.ballRadius);

    // every side bounds the field: unused or eliminated sides are solid walls
    const r = cfg.ballRadius;
    for (let k = 0; k < 4; k++) {
      // into the side's canonical frame: goal line at y = +H, viewer at the bottom
      const [px, py] = rotQuarter(b.x - C, b.y - C, 4 - k);
      const [vx, vy] = rotQuarter(b.vx, b.vy, 4 - k);
      if (vy <= 0) continue;
      const side = this.sides[k];
      const face = H - PADDLE_T - r;

      if (side.alive) {
        if (py >= face) {
          const pad = this.paddleAt(k, px, r);
          if (pad && py <= H + r * 0.2) {
            const speedNow = Math.hypot(vx, vy);
            if (this.modules.some((m) => m.paddleContact?.(b, pad, speedNow))) return;
            this.hitPaddle(b, k, pad, px, vx, vy);
            return;
          }
        }
        if (py - r > H) {
          this.concede(b, k);
          return;
        }
      } else if (py + r > H) {
        // dead / unused side is a solid wall
        const [nx, ny] = rotQuarter(px, H - r, k);
        b.x = C + nx;
        b.y = C + ny;
        const [rvx, rvy] = rotQuarter(vx, -vy, k);
        b.vx = rvx;
        b.vy = rvy;
      }
    }
  }

  private paddleAt(side: number, px: number, r: number): Paddle | null {
    for (const p of this.paddles) {
      if (p.side !== side || !p.alive) continue;
      if (Math.abs(px - p.pos) <= p.len / 2 + r * 0.6) return p;
    }
    return null;
  }

  private hitPaddle(b: Ball, side: number, pad: Paddle, px: number, vx: number, vy: number): void {
    const cfg = this.cfg;
    const r = cfg.ballRadius;
    const speed = Math.hypot(vx, vy);
    const base = Math.max(cfg.ballMinSpeed, speed) * cfg.hitGain;
    // a still-boosted ball keeps its current speed through a normal hit (it eases down on its own)
    const next = Math.min(base, b.boost > 0 ? Math.max(cfg.ballMaxSpeed, speed) : cfg.ballMaxSpeed);
    const offset = clamp((px - pad.pos) / (pad.len / 2 + r * 0.6), -1, 1);
    const angle = offset * MAX_ANGLE;
    let nvx = Math.sin(angle) * next + pad.vel * 0.25;
    let nvy = -Math.cos(angle) * next;
    const len = Math.hypot(nvx, nvy);
    nvx = (nvx / len) * next;
    nvy = (nvy / len) * next;

    const [wx, wy] = rotQuarter(px, H - PADDLE_T - r, side);
    b.x = C + wx;
    b.y = C + wy;
    const [wvx, wvy] = rotQuarter(nvx, nvy, side);
    b.vx = wvx;
    b.vy = wvy;
    this.events.push({ kind: 'hit', id: pad.id, x: r1(b.x), y: r1(b.y) });
  }

  private concede(b: Ball, k: number): void {
    const side = this.sides[k];
    side.lives--;
    side.conceded++;
    const owner = this.paddles.find((p) => p.side === k);
    this.events.push({ kind: 'goal', id: owner?.id ?? '', x: r1(b.x), y: r1(b.y) });
    if (side.lives <= 0) this.eliminateSide(k);
    if (b.disposable) this.removeBall(b);
    else this.queue(b);
  }

  private eliminateSide(k: number): void {
    const side = this.sides[k];
    side.alive = false;
    side.lives = 0;
    side.elimOrder = ++this.elimCounter;
    for (const p of this.paddles) {
      if (p.side === k && p.alive) {
        p.alive = false;
        for (const m of this.modules) m.paddleGone?.(p);
        this.events.push({ kind: 'eliminated', id: p.id, x: r1(C), y: r1(C) });
      }
    }
  }

  private removeBall(b: Ball): void {
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
  }

  // ---- ball lifecycle ------------------------------------------------------

  private newBall(): Ball {
    return {
      id: this.nextBallId++,
      x: C,
      y: C,
      vx: 0,
      vy: 0,
      px: C,
      py: C,
      wait: 0,
      corner: -1,
      boost: 0,
      held: false,
      disposable: false,
      life: Infinity,
    };
  }

  /** base +- variance seconds: a fresh random value on every call. */
  private jittered(base: number, variance: number): number {
    return nextIn(this.rand, base, variance, SPAWN_MIN_GAP);
  }

  /** Random corner, preferring one other than the last used. */
  private pickCorner(): number {
    const options = [0, 1, 2, 3].filter((c) => c !== this.lastCorner);
    const c = options[Math.floor(this.rand() * options.length)];
    this.lastCorner = c;
    return c;
  }

  /** Park the ball in a random corner block and charge for a random delay. */
  private queue(b: Ball): void {
    const corner = this.pickCorner();
    const [x, y] = cornerCenter(corner);
    b.corner = corner;
    b.x = x;
    b.y = y;
    b.vx = b.vy = 0;
    b.boost = 0;
    b.held = false;
    b.wait = this.jittered(this.cfg.spawn.delay, this.cfg.spawn.variance);
  }

  private spawnBall(): void {
    const b = this.newBall();
    this.queue(b);
    this.balls.push(b);
  }

  /** Launch from the corner's quarter disc along its diagonal into the field. */
  private serve(b: Ball): void {
    const [cx, cy] = fieldCorner(b.corner);
    const sx = Math.sign(C - cx);
    const sy = Math.sign(C - cy);
    const r = this.cfg.ballRadius;
    // just outside the quarter disc, on its diagonal, so it isn't pushed straight back
    const off = (CORNER_SIZE + r * 0.7) / Math.SQRT2;
    b.x = cx + sx * off;
    b.y = cy + sy * off;
    const base = Math.atan2(sy, sx);
    const a = base + (this.rand() * 2 - 1) * LAUNCH_SPREAD;
    b.vx = Math.cos(a) * this.cfg.ballSpeed;
    b.vy = Math.sin(a) * this.cfg.ballSpeed;
    b.px = b.x;
    b.py = b.y;
    this.events.push({ kind: 'spawn', id: '', x: r1(b.x), y: r1(b.y) });
    b.corner = -1;
  }

  // ---- Minigame output -----------------------------------------------------

  getState(): BallArenaState {
    const state: BallArenaState = {
      kind: 'ext:ballistix',
      variant: this.cfg.id,
      t: r1(this.t),
      limit: this.cfg.timeLimit,
      boostRadius: this.cfg.smashRadius,
      sides: this.sides.map((s, side) => ({
        side,
        used: s.used,
        alive: s.alive,
        lives: s.lives,
        maxLives: this.cfg.lives,
      })),
      paddles: this.paddles.map((p) => {
        let d = p.smashCd <= 0 ? 1 : r2(1 - p.smashCd / this.cfg.smashCooldown);
        for (const m of this.modules) {
          const o = m.cooldownFraction?.(p);
          if (o !== undefined) d = o;
        }
        return { id: p.id, side: p.side, pos: r1(p.pos), len: r1(p.len), alive: p.alive, d, pulse: r2(p.pulseT / PULSE_TIME) };
      }),
      balls: this.balls.map((b) => ({
        id: b.id,
        x: r1(b.x),
        y: r1(b.y),
        r: this.cfg.ballRadius,
        wait: b.wait > 0,
        corner: b.wait > 0 ? b.corner : -1,
        boost: r2(b.boost),
      })),
    };
    for (const m of this.modules) m.extendState?.(state);
    return state;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  isFinished(): boolean {
    return this.finished;
  }

  getPlacements(): RawPlacement[] {
    // better side = still alive, then more lives / later elimination, then fewer goals conceded
    const used = this.sides.map((s, k) => ({ k, s })).filter((x) => x.s.used);
    const key = ({ s }: { s: Side }) => [s.alive ? 1 : 0, s.alive ? s.lives : s.elimOrder, -s.conceded];
    const cmp = (a: number[], b: number[]) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    };
    const out: RawPlacement[] = [];
    for (const x of used) {
      let better = 0;
      for (const o of used) {
        if (cmp(key(o), key(x)) > 0) better += this.paddles.filter((p) => p.side === o.k).length;
      }
      for (const p of this.paddles) if (p.side === x.k) out.push({ id: p.id, place: better + 1 });
    }
    return out;
  }
}
