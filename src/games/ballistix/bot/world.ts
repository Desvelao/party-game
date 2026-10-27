// Turns a Ballistix snapshot into the bot's view: own-side frame, estimated velocities, which edges are living goals.
import { CORNER_SIZE, cornerCenter, rotQuarter } from '../shared/geometry';
import type { BallArenaState } from '../shared/types';
import { EntityTracker } from '../../../core/shared/kit/track';
import { WORLD_SIZE } from '../../../core/shared/constants';
import { H, PADDLE_T, advance, type Env, type Circle, type Pull, type Repulsor } from './physics';
import { physicsFor } from './variants';

const C = WORLD_SIZE / 2;

export interface WBall {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  boost: number;
  /** velocity is known (seen in two snapshots) */
  known: boolean;
}

export interface World {
  tick: number;
  /** game time of the snapshot, s */
  time: number;
  recvMs: number;
  variant: string;
  mySide: number;
  /** laneL/laneR: the stretch of the goal this paddle may move in (a team splits it, like the server) */
  me: { pos: number; vel: number; len: number; ready: number; alive: boolean; laneL: number; laneR: number } | null;
  balls: WBall[];
  /** by edge relative to our side */
  lives: number[];
  alive: boolean[];
  env: Env;
  boostRadius: number;
  /** Sand Orb: our magnet (balls stuck to any paddle are left out of `balls`) */
  magnet: { pulling: boolean; held: number; /** 1 -> 0 */ holdLeft: number; range: number } | null;
  state: BallArenaState;
}

export class WorldModel {
  private balls = new EntityTracker(4);
  private pad = new EntityTracker(1e9);
  mySide = -1;

  /** `aware` false: ignore everything variant-specific (the smash ball view of every variant, for A/B tests) */
  constructor(private readonly selfId: string, private readonly tickRate: number, private readonly aware = true) {}

  get corrected(): number {
    return this.balls.corrected;
  }
  get fallback(): number {
    return this.balls.fallback;
  }

  update(s: BallArenaState, tick: number, recvMs: number): World | null {
    const mine = s.paddles.find((p) => p.id === this.selfId);
    if (mine) this.mySide = mine.side;
    if (this.mySide < 0) return null;
    const rot = (4 - this.mySide) % 4;
    const time = tick / this.tickRate;
    const r = s.balls[0]?.r ?? 18;

    const open = [false, false, false, false];
    const lives = [0, 0, 0, 0];
    const alive = [false, false, false, false];
    for (const sd of s.sides) {
      const rel = (sd.side - this.mySide + 4) % 4;
      open[rel] = sd.used && sd.alive;
      alive[rel] = sd.used && sd.alive;
      lives[rel] = sd.lives;
    }
    open[0] = false; // our own edge is handled by the paddle contact plane
    const ph = this.aware ? physicsFor(s.variant) : {};
    const obstacles: Circle[] = [];
    const swap = rot % 2 === 1;
    if (s.enemy && s.enemy.phase !== 'off') obstacles.push({ x: 0, y: 0, r: s.enemy.r });
    const env: Env = { r, open, obstacles };
    if (ph.drag) env.drag = ph.drag;
    if (ph.vmin) env.vmin = ph.vmin;
    if (ph.vmax) env.vmax = ph.vmax;
    if (ph.vmaxSmash) env.vmaxSmash = ph.vmaxSmash;
    if (ph.pullAccel && s.engines) {
      const pulls: Pull[] = [];
      s.engines.forEach((en, i) => {
        if (en.phase === 'ok' && en.pull <= 0) return;
        const [wx, wy] = cornerCenter(i);
        const [x, y] = rotQuarter(wx - C, wy - C, rot);
        const warn = en.phase === 'warn';
        const fail = ph.engineFail ?? 6;
        pulls.push({
          x,
          y,
          accel: ph.pullAccel!,
          start: warn ? en.left * (ph.engineWarn ?? 1.5) : 0,
          dur: warn ? fail : en.phase === 'fail' ? en.left * fail : 0,
          ramp0: en.pull,
        });
      });
      if (pulls.length) env.pulls = pulls;
    }
    if (ph.repelForce && s.repel && s.repel.paddles.length) {
      const reps: Repulsor[] = [];
      for (const e of s.repel.paddles) {
        // our own is left out: we steer by where the ball will be, and the push depends on where we stand (it would chase itself)
        if (e.id === this.selfId) continue;
        const p = s.paddles.find((q) => q.id === e.id);
        if (!p?.alive) continue;
        // the paddle face, in our frame: the side frame turned by its side and ours
        const [x, y] = rotQuarter(p.pos, H - PADDLE_T / 2, (p.side + rot) % 4);
        reps.push({ x, y, radius: s.repel.radius, force: ph.repelForce, until: e.left * (ph.repelDuration ?? 8) });
      }
      if (reps.length) env.repulsors = reps;
    }
    const held = this.aware && s.magnet ? new Set(s.magnet.held) : null;

    const seen = new Set<number | string>();
    const balls: WBall[] = [];
    for (const b of s.balls) {
      seen.add(b.id);
      if (b.wait || held?.has(b.id)) {
        // charging in a corner launcher: no velocity yet
        this.balls.reset(b.id);
        continue;
      }
      const [x, y] = rotQuarter(b.x - C, b.y - C, rot);
      const tr = this.balls.observe(b.id, x, y, time, (prev, dt) => advance(prev, dt, env));
      balls.push({ id: b.id, x, y, vx: tr.vx, vy: tr.vy, r: b.r, boost: b.boost, known: tr.known });
    }
    this.balls.prune(seen);

    let me: World['me'] = null;
    if (mine) {
      const tr = this.pad.observe('me', mine.pos, 0, time);
      // players of a side share the goal between the corner blocks in equal lanes, in snapshot order
      const team = s.paddles.filter((p) => p.side === mine.side);
      const span = H - CORNER_SIZE;
      const lane = (2 * span) / team.length;
      const laneL = -span + team.indexOf(mine) * lane;
      me = { pos: mine.pos, vel: tr.known ? tr.vx : 0, len: mine.len, ready: mine.d, alive: mine.alive, laneL, laneR: laneL + lane };
    }
    let magnet: World['magnet'] = null;
    if (this.aware && s.magnet) {
      const m = s.magnet.paddles.find((p) => p.id === this.selfId);
      if (m) magnet = { pulling: m.pulling, held: m.held, holdLeft: m.holdLeft, range: s.magnet.range };
    }
    return { tick, time, recvMs, variant: s.variant, mySide: this.mySide, me, balls, lives, alive, env, boostRadius: s.boostRadius, magnet, state: s };
  }
}
