import type { GameEvent, InputState } from '../../../core/shared/types';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../core/shared/plugin-api';
import { NO_INPUT } from '../../../core/shared/types';
import { WORLD_SIZE } from '../../../core/shared/constants';
import { nextIn } from '../../../core/shared/kit/util';
import {
  LOGS_FINISH_Y,
  LOGS_LEFT,
  LOGS_RIGHT,
  LOGS_START_Y,
  logsLayout,
  type LogsLayout,
} from '../shared/geometry';
import type { LogsPlayerState, LogsState } from '../shared/types';
import { clamp, r1, r2 } from './util';
import { DEFAULT_CONFIG, type CrazyLogsConfig } from './config';

// exported constants: the bot (bot/physics.ts) plans with them, so they cannot drift apart
export const PLAYER_R = 22;
export const WALK_SPEED = 190;
export const HOP_TIME = 0.3; // s in the air
export const HOP_COOLDOWN = 0.2; // s after landing
/** a hop that lands this close to a log or bank is pulled onto it instead of into the water */
export const LAND_ASSIST = 16;
/*
 * Logs lie across the river, so a rolling log's surface moves along y. They start still. Where a
 * player is relative to the log's axis (offset -1 far edge .. +1 near edge) pushes the spin: a landing
 * adds `offset * landImpulse` at once and standing there adds `offset * standTorque` per second (see
 * config.ts). It all adds to the current speed, so the other side of the axis slows the spin and, when
 * it was slow, reverses it.
 */
export const START_Y = 875;
/** water jets: warning time, eruption display time, push radius, how quickly the knock-back dies out */
export const JET_WARN = 1.0; // s
const JET_SHOW = 0.5; // s
export const JET_RADIUS = 80;
const JET_DECAY = 5; // 1/s
/** shortest time in the water, whatever the variance */
const RESPAWN_MIN = 0.2;
const JET_MIN_GAP = 1; // s
const STRIPE = 40; // px, period of the stripes the client draws on a log

type Ground = { kind: 'start' } | { kind: 'finish' } | { kind: 'log'; row: number } | { kind: 'water' };

interface P {
  id: string;
  x: number;
  y: number;
  facing: number;
  /** still in the match (false after a disconnect) */
  alive: boolean;
  /** disconnect order (1 = first to leave), 0 while connected: leavers place below everyone connected */
  left: number;
  startX: number;
  /** crossings completed: the points */
  score: number;
  falls: number;
  /** seconds left sinking in the water before returning to the start, 0 = in play */
  respawn: number;
  /** length of the current sink, the 100 % of the snapshot's `w` */
  respawnTotal: number;
  hopT: number; // 0 = on the ground, otherwise seconds left in the air
  hopFromX: number;
  hopFromY: number;
  hopToX: number;
  hopToY: number;
  hopCd: number;
  /** knock-back velocity from water jets, decays */
  kx: number;
  ky: number;
  input: InputState;
}

interface Jet {
  x: number;
  y: number;
  /** seconds of warning left; 0 = erupted */
  warn: number;
  /** seconds the eruption stays on show */
  show: number;
}

export class CrazyLogs implements Minigame {
  readonly id = 'crazy-logs';
  readonly name = 'Crazy Logs';

  private players: P[] = [];
  private byId = new Map<string, P>();
  private events: GameEvent[] = [];
  private t = 0;
  private finished = false;
  private leaveSeq = 0;
  private speeds: number[] = [];
  private phases: number[] = [];

  private jets: Jet[] = [];
  private nextJet = 0;

  private readonly layout: LogsLayout;

  constructor(
    private readonly cfg: CrazyLogsConfig = DEFAULT_CONFIG,
    private readonly rng: () => number = Math.random,
  ) {
    this.layout = logsLayout(cfg.logCount, cfg.logSize);
  }

  init(players: MinigamePlayer[]): void {
    this.players = [];
    this.byId.clear();
    this.events = [];
    this.t = 0;
    this.finished = false;
    this.leaveSeq = 0;
    this.speeds = Array.from({ length: this.layout.count }, () => 0);
    this.phases = this.speeds.map(() => 0);
    this.jets = [];
    this.nextJet = this.jetDelay();

    const n = players.length;
    players.forEach((pl, i) => {
      const x = ((i + 0.5) / n) * WORLD_SIZE;
      const y = START_Y;
      const p: P = {
        id: pl.id,
        x,
        y,
        facing: -Math.PI / 2,
        alive: true,
        left: 0,
        startX: x,
        score: 0,
        falls: 0,
        respawn: 0,
        respawnTotal: 1,
        hopT: 0,
        hopFromX: x,
        hopFromY: y,
        hopToX: x,
        hopToY: y,
        hopCd: 0,
        kx: 0,
        ky: 0,
        input: NO_INPUT,
      };
      this.players.push(p);
      this.byId.set(p.id, p);
    });
  }

  handleInput(playerId: string, input: InputState): void {
    const p = this.byId.get(playerId);
    if (p) p.input = input;
  }

  removePlayer(playerId: string): void {
    const p = this.byId.get(playerId);
    if (!p || !p.alive) return;
    p.alive = false;
    p.left = ++this.leaveSeq;
  }

  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;
    // standing on a log pushes it: the far half spins it towards the far bank, the near half back
    for (const p of this.players) {
      if (!p.alive || p.respawn > 0 || p.hopT > 0) continue;
      const g = this.groundAt(p.x, p.y);
      if (g.kind !== 'log') continue;
      const offset = clamp((p.y - this.layout.centres[g.row]) / this.layout.half, -1, 1);
      this.speeds[g.row] = clamp(this.speeds[g.row] + offset * this.cfg.standTorque * dt, -this.cfg.maxSpin, this.cfg.maxSpin);
    }
    this.stepJets(dt);
    for (let i = 0; i < this.layout.count; i++) {
      const v = this.speeds[i] * Math.exp(-this.cfg.spinFade * dt);
      this.speeds[i] = Math.abs(v) < 0.5 ? 0 : v;
      this.phases[i] = (this.phases[i] + this.speeds[i] * dt) % STRIPE;
    }

    for (const p of this.players) {
      if (p.alive) this.stepPlayer(p, dt);
    }
    this.separate();

    if (this.t >= this.cfg.timeLimit || !this.players.some((p) => p.alive)) this.finished = true;
  }

  /** Seconds until the next jet: interval +- variance, never less than JET_MIN_GAP. */
  private jetDelay(): number {
    const { jetInterval, jetVariance } = this.cfg;
    return nextIn(this.rng, jetInterval, jetVariance, JET_MIN_GAP);
  }

  private stepJets(dt: number): void {
    // knock-back left over from earlier jets: move players (and an airborne hop's path with them)
    const decay = Math.exp(-JET_DECAY * dt);
    for (const p of this.players) {
      if (p.kx === 0 && p.ky === 0) continue;
      if (p.alive && p.respawn === 0) {
        const dx = p.kx * dt;
        const dy = p.ky * dt;
        p.x = clamp(p.x + dx, PLAYER_R, WORLD_SIZE - PLAYER_R);
        p.y += dy;
        if (p.hopT > 0) {
          p.hopFromX += dx;
          p.hopToX += dx;
          p.hopFromY += dy;
          p.hopToY += dy;
        }
      }
      p.kx *= decay;
      p.ky *= decay;
      if (Math.hypot(p.kx, p.ky) < 1) p.kx = p.ky = 0;
    }
    if (!this.cfg.jets) return;

    this.nextJet -= dt;
    if (this.nextJet <= 0) {
      const row = Math.floor(this.rng() * this.layout.count);
      const x = LOGS_LEFT + this.rng() * (LOGS_RIGHT - LOGS_LEFT);
      this.jets.push({ x, y: this.layout.centres[row], warn: JET_WARN, show: JET_SHOW });
      this.nextJet = this.jetDelay();
    }
    for (const j of this.jets) {
      if (j.warn > 0) {
        j.warn = Math.max(0, j.warn - dt);
        if (j.warn === 0) this.erupt(j);
      } else {
        j.show -= dt;
      }
    }
    this.jets = this.jets.filter((j) => j.show > 0);
  }

  private erupt(j: Jet): void {
    this.events.push({ kind: 'jet', id: '', x: r1(j.x), y: r1(j.y) });
    for (const p of this.players) {
      if (!p.alive || p.respawn > 0) continue;
      const dx = p.x - j.x;
      const dy = p.y - j.y;
      const d = Math.hypot(dx, dy);
      if (d >= JET_RADIUS) continue;
      // away from the centre, a bit weaker at the rim; dead centre goes up the river
      const k = this.cfg.jetForce * (1 - 0.5 * (d / JET_RADIUS));
      const nx = d < 1 ? 0 : dx / d;
      const ny = d < 1 ? -1 : dy / d;
      p.kx += nx * k;
      p.ky += ny * k;
    }
    // a log under the jet is kicked too, either way: this is what can reverse a spin
    const row = this.layout.centres.findIndex((c) => Math.abs(c - j.y) < 1);
    if (row >= 0) {
      const dir = this.rng() < 0.5 ? -1 : 1;
      this.speeds[row] = clamp(this.speeds[row] + dir * this.cfg.jetForce * 0.5, -this.cfg.maxSpin, this.cfg.maxSpin);
    }
  }

  private groundAt(x: number, y: number, slack = 0): Ground {
    if (y <= LOGS_FINISH_Y) return { kind: 'finish' };
    if (y >= LOGS_START_Y) return { kind: 'start' };
    if (x >= LOGS_LEFT - slack && x <= LOGS_RIGHT + slack) {
      for (let i = 0; i < this.layout.count; i++) {
        if (Math.abs(y - this.layout.centres[i]) <= this.layout.half + slack) return { kind: 'log', row: i };
      }
    }
    return { kind: 'water' };
  }

  private stepPlayer(p: P, dt: number): void {
    p.hopCd = Math.max(0, p.hopCd - dt);
    if (p.respawn > 0) {
      // sinking: back to the beginning once the splash is over
      p.respawn = Math.max(0, p.respawn - dt);
      if (p.respawn === 0) this.toStart(p);
      return;
    }
    let { mx, my } = p.input;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    if (p.hopT > 0) {
      p.hopT = Math.max(0, p.hopT - dt);
      const k = 1 - p.hopT / HOP_TIME;
      p.x = p.hopFromX + (p.hopToX - p.hopFromX) * k;
      p.y = p.hopFromY + (p.hopToY - p.hopFromY) * k;
      if (p.hopT === 0) this.land(p);
      return;
    }

    if (len > 0.1) p.facing = Math.atan2(my, mx);
    const g = this.groundAt(p.x, p.y);
    if (g.kind === 'water') {
      this.fall(p);
      return;
    }

    if (p.input.a1 && p.hopCd <= 0) {
      // hop towards the stick, or straight ahead (up the river) with no input
      let dx = 0;
      let dy = -1;
      if (len > 0.3) {
        dx = mx / len;
        dy = my / len;
      }
      p.facing = Math.atan2(dy, dx);
      p.hopFromX = p.x;
      p.hopFromY = p.y;
      p.hopToX = clamp(p.x + dx * this.cfg.hopDistance, PLAYER_R, WORLD_SIZE - PLAYER_R);
      p.hopToY = clamp(p.y + dy * this.cfg.hopDistance, 0, WORLD_SIZE - PLAYER_R);
      p.hopT = HOP_TIME;
      this.events.push({ kind: 'dash', id: p.id, x: r1(p.x), y: r1(p.y) });
      return;
    }

    // on the ground: walk (and ride the log)
    let nx = p.x + mx * WALK_SPEED * dt;
    let ny = p.y + my * WALK_SPEED * dt;
    if (g.kind === 'log') {
      // the spinning surface drags the player along y; past either edge of the log is water
      ny += this.speeds[g.row] * dt;
    } else {
      ny = clamp(ny, LOGS_START_Y + PLAYER_R * 0.5, WORLD_SIZE - PLAYER_R);
      nx = clamp(nx, PLAYER_R, WORLD_SIZE - PLAYER_R);
    }
    p.x = nx;
    p.y = ny;

    if (g.kind === 'log' && (p.x < LOGS_LEFT - PLAYER_R * 0.35 || p.x > LOGS_RIGHT + PLAYER_R * 0.35)) {
      this.fall(p);
    }
  }

  private land(p: P): void {
    p.hopCd = HOP_COOLDOWN;
    let g = this.groundAt(p.x, p.y);
    if (g.kind === 'water') {
      // forgiving landings: snap onto a log or bank edge that is almost under the player
      const near = this.groundAt(p.x, p.y, LAND_ASSIST);
      if (near.kind === 'log') {
        const cy = this.layout.centres[near.row];
        p.y = clamp(p.y, cy - this.layout.half, cy + this.layout.half);
        p.x = clamp(p.x, LOGS_LEFT, LOGS_RIGHT);
        g = near;
      } else if (p.y > LOGS_START_Y - LAND_ASSIST && p.y < LOGS_START_Y) {
        p.y = LOGS_START_Y;
        g = { kind: 'start' };
      } else if (p.y < LOGS_FINISH_Y + LAND_ASSIST && p.y > LOGS_FINISH_Y) {
        p.y = LOGS_FINISH_Y;
        g = { kind: 'finish' };
      }
    }
    if (g.kind === 'water') this.fall(p);
    else if (g.kind === 'finish') this.cross(p);
    else if (g.kind === 'log') {
      // far half of the log spins it towards the far bank (negative), near half back towards the start
      const offset = clamp((p.y - this.layout.centres[g.row]) / this.layout.half, -1, 1);
      this.speeds[g.row] = clamp(this.speeds[g.row] + offset * this.cfg.landImpulse, -this.cfg.maxSpin, this.cfg.maxSpin);
    }
  }

  /** Reached the far bank: a point, then straight back to the start to cross again. */
  private cross(p: P): void {
    p.score++;
    this.events.push({ kind: 'bank', id: p.id, x: r1(p.x), y: r1(Math.min(p.y, LOGS_FINISH_Y - 10)) });
    this.toStart(p);
  }

  /** In the river: sink for a moment, then restart from the beginning (see stepPlayer). */
  private fall(p: P): void {
    if (p.respawn > 0) return;
    p.falls++;
    p.hopT = 0;
    this.events.push({ kind: 'splash', id: p.id, x: r1(p.x), y: r1(p.y) });
    if (this.cfg.respawnTime <= 0) this.toStart(p);
    else p.respawn = p.respawnTotal = nextIn(this.rng, this.cfg.respawnTime, this.cfg.respawnVariance, RESPAWN_MIN);
  }

  private toStart(p: P): void {
    p.x = p.startX;
    p.y = START_Y;
    p.facing = -Math.PI / 2;
    p.hopT = 0;
    p.hopCd = 0;
    p.respawn = 0;
  }

  /** Grounded racers shove each other apart; airborne ones fly over. */
  private separate(): void {
    const ps = this.players.filter((p) => p.alive && p.respawn === 0 && p.hopT === 0);
    const minDist = PLAYER_R * 2;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (minDist - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }

  getState(): LogsState {
    const players: LogsPlayerState[] = this.players.map((p) => ({
      id: p.id,
      x: r1(p.x),
      y: r1(p.y),
      f: r2(p.facing),
      alive: p.alive,
      h: p.hopT > 0 ? r2(1 - p.hopT / HOP_TIME) : 0,
      d: p.hopCd <= 0 ? 1 : r2(1 - p.hopCd / HOP_COOLDOWN),
      score: p.score,
      falls: p.falls,
      w: p.respawn > 0 ? r2(p.respawn / p.respawnTotal) : 0,
    }));
    return {
      kind: 'ext:crazy-logs',
      t: r1(this.t),
      limit: this.cfg.timeLimit,
      rows: this.speeds.map((v, i) => ({ v: r1(v), ph: r1(this.phases[i]), y: r1(this.layout.centres[i]) })),
      half: r1(this.layout.half),
      jets: this.jets.map((j) => ({ x: r1(j.x), y: r1(j.y), w: r2(j.warn / JET_WARN), e: j.warn === 0 })),
      players,
    };
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
    // connected players first: most points wins, fewer falls breaks a tie, equal on both share the place;
    // leavers follow, the later the disconnect the better
    const sorted = [...this.players].sort(
      (a, b) => Number(a.left > 0) - Number(b.left > 0) || b.left - a.left || b.score - a.score || a.falls - b.falls,
    );
    let place = 0;
    return sorted.map((p, i) => {
      const prev = sorted[i - 1];
      if (!prev || prev.left !== p.left || prev.score !== p.score || prev.falls !== p.falls) place = i + 1;
      return { id: p.id, place };
    });
  }
}
