// Ballistix physics as the bot needs it, in the bot's own frame: the bot's goal is the bottom edge (+y),
// x runs along it, the field centre is (0,0). The constants are the server's own (server/core/geometry.ts); the
// corner bounce mirrors server/core. The bot only knows what snapshots show, so balls, other paddles and moving
// obstacles are approximated.
import { CORNER_SIZE } from '../shared/geometry';
import { BALL_CEIL } from '../server/core/config';
import { ENGINE_RAMP } from '../server/variants/cloudOrbs';

export { H, MAX_ANGLE, PADDLE_RESPONSE, PADDLE_SPEED, PADDLE_T } from '../server/core/geometry';
import { BOOST_DECAY, H, PADDLE_T } from '../server/core/geometry';
/** how far the ball centre is from the goal edge when it touches a paddle */
export const contactY = (r: number) => H - PADDLE_T - r;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** smash boost left, 1 -> 0 (the server eases the speed ceiling back as it fades) */
  boost?: number;
}

/** Harmonic motion of an obstacle about (cx, cy) per axis, from its position and velocity now (x(t) = x0 cos wt + v/w sin wt). */
export interface Orbit {
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
  /** moving obstacle: x,y is where it is now */
  orbit?: Orbit;
}

/** A failing engine pulling every free ball towards (x, y); its strength ramps in and out like the server's (2/s). */
export interface Pull {
  x: number;
  y: number;
  accel: number;
  /** seconds until the failure begins (0 = failing now) */
  start: number;
  /** seconds it lasts */
  dur: number;
  /** pull strength now, 0..1 */
  ramp0: number;
}

/** A paddle with the repulsion power-up: pushes balls within `radius` of its face away (fixed where it is now). */
export interface Repulsor {
  x: number;
  y: number;
  radius: number;
  force: number;
  /** seconds the effect has left */
  until: number;
}

const PULL_RAMP = ENGINE_RAMP;

/** Pull strength factor `t` seconds from now. */
export function pullRamp(p: Pull, t: number): number {
  const atStart = Math.max(0, p.ramp0 - PULL_RAMP * p.start);
  if (t <= p.start) return Math.max(0, p.ramp0 - PULL_RAMP * t);
  const end = p.start + p.dur;
  if (t <= end) return Math.min(1, atStart + PULL_RAMP * (t - p.start));
  const atEnd = Math.min(1, atStart + PULL_RAMP * p.dur);
  return Math.max(0, atEnd - PULL_RAMP * (t - end));
}

export interface Env {
  r: number;
  /** by edge relative to the bot's side (0 own, 1 left, 2 top, 3 right): true = a living goal there, false = solid wall */
  open: boolean[];
  obstacles: Circle[];
  /** Sand Orb: speed decay, 1/s */
  drag?: number;
  /** speed floor / ceiling the server clamps free balls to (px/s); 0 or unset = none */
  vmin?: number;
  vmax?: number;
  /** ceiling of a fully boosted (smashed) ball; it eases down to `vmax` as the boost fades */
  vmaxSmash?: number;
  /** Cloud Orbs: failing engines */
  pulls?: Pull[];
  /** Pulse Ball: paddles with the repulsion power-up (ours and the opponents') */
  repulsors?: Repulsor[];
}

export type Step = 'ok' | 'out' | 'hit';

function bounce(b: Ball, nx: number, ny: number): void {
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) {
    b.vx -= 2 * dot * nx;
    b.vy -= 2 * dot * ny;
  }
}

/** Bumpers and the enemy body reflect and add 5 % speed, up to ballMaxSpeed (server/core/physics.ts bounceCircle). */
function bounceObstacle(b: Ball, nx: number, ny: number, env: Env): void {
  const dot = b.vx * nx + b.vy * ny;
  if (dot >= 0) return;
  b.vx -= 2 * dot * nx;
  b.vy -= 2 * dot * ny;
  const sp = Math.hypot(b.vx, b.vy);
  const target = Math.min(env.vmax ? env.vmax / BALL_CEIL : Infinity, sp * 1.05);
  if (sp > 1e-6 && target > sp) {
    b.vx *= target / sp;
    b.vy *= target / sp;
  }
}

/** Move `b` by `h` seconds, bouncing off corners, walls and obstacles. 'out': it left through a living goal.
 *  `tt` is the time from now at which the step starts (moving obstacles and engine pulls depend on it). */
export function step(b: Ball, h: number, env: Env, tt = 0): Step {
  const r = env.r;
  const pulls = env.pulls;
  if (pulls) {
    for (let i = 0; i < pulls.length; i++) {
      const p = pulls[i];
      const k = pullRamp(p, tt);
      if (k <= 0) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) continue;
      const a = (p.accel * k * h) / d;
      b.vx += dx * a;
      b.vy += dy * a;
    }
  }
  const reps = env.repulsors;
  if (reps) {
    for (let i = 0; i < reps.length; i++) {
      const q = reps[i];
      if (tt >= q.until) continue;
      const dx = b.x - q.x;
      const dy = b.y - q.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > q.radius || d < 1e-3) continue;
      const a = (q.force * (1 - 0.5 * (d / q.radius)) * h) / d;
      b.vx += dx * a;
      b.vy += dy * a;
    }
  }
  if (env.drag) {
    const k = Math.exp(-env.drag * h);
    b.vx *= k;
    b.vy *= k;
  }
  if (b.boost) b.boost = Math.max(0, b.boost - h / BOOST_DECAY);
  if (env.vmax || env.vmin) {
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    const vmax = env.vmax && env.vmaxSmash && b.boost ? env.vmax + (env.vmaxSmash - env.vmax) * b.boost : env.vmax;
    if (vmax && sp > vmax) {
      b.vx *= vmax / sp;
      b.vy *= vmax / sp;
    } else if (env.vmin && sp < env.vmin && sp > 1e-6) {
      b.vx *= env.vmin / sp;
      b.vy *= env.vmin / sp;
    }
  }
  b.x += b.vx * h;
  b.y += b.vy * h;
  const reach = CORNER_SIZE + r;
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      const dx = b.x - sx * H;
      const dy = b.y - sy * H;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2) || 1;
      b.x = sx * H + (dx / d) * reach;
      b.y = sy * H + (dy / d) * reach;
      bounce(b, dx / d, dy / d);
    }
  }
  const obs = env.obstacles;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    let ox = o.x;
    let oy = o.y;
    if (o.orbit) {
      const q = o.orbit;
      const t = tt + h;
      ox = q.cx + (o.x - q.cx) * Math.cos(q.wx * t) + (q.vx / q.wx) * Math.sin(q.wx * t);
      oy = q.cy + (o.y - q.cy) * Math.cos(q.wy * t) + (q.vy / q.wy) * Math.sin(q.wy * t);
    }
    const dx = b.x - ox;
    const dy = b.y - oy;
    const min = o.r + r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1;
    b.x = ox + (dx / d) * min;
    b.y = oy + (dy / d) * min;
    bounceObstacle(b, dx / d, dy / d, env);
  }
  // left (rel 1), top (rel 2), right (rel 3)
  if (b.x - r < -H) {
    if (env.open[1]) {
      if (b.x + r < -H) return 'out';
    } else {
      b.x = -H + r;
      if (b.vx < 0) b.vx = -b.vx;
    }
  }
  if (b.x + r > H) {
    if (env.open[3]) {
      if (b.x - r > H) return 'out';
    } else {
      b.x = H - r;
      if (b.vx > 0) b.vx = -b.vx;
    }
  }
  if (b.y - r < -H) {
    if (env.open[2]) {
      if (b.y + r < -H) return 'out';
    } else {
      b.y = -H + r;
      if (b.vy < 0) b.vy = -b.vy;
    }
  }
  if (b.vy > 0 && b.y >= contactY(r)) return 'hit';
  return 'ok';
}

const SUB = 1 / 120;

/** Simulate `dt` seconds (ignoring paddles). Used to check a track: does the ball end up where it was seen? */
export function advance(b: Ball, dt: number, env: Env): Ball {
  const c: Ball = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, boost: b.boost };
  let left = dt;
  let tt = 0;
  while (left > 1e-9) {
    const h = Math.min(SUB, left);
    left -= h;
    const prevY = c.y;
    const s = step(c, h, env, tt);
    tt += h;
    // paddles are not simulated: a ball crossing our contact plane just goes on
    if (s === 'hit') c.y = Math.max(prevY, c.y);
  }
  return c;
}

export interface Impact {
  /** seconds from now until the ball touches the bot's paddle plane */
  t: number;
  /** lateral position of the ball centre at that moment */
  x: number;
  vx: number;
  vy: number;
  /** wall/corner bounces on the way */
  bounces: number;
}

/** When and where will this ball reach our paddle plane? null if it leaves elsewhere or takes longer than `horizon`. */
export function project(b0: Ball, env: Env, horizon: number): Impact | null {
  if (b0.vy <= 0 && Math.abs(b0.vx) < 1 && Math.abs(b0.vy) < 1) return null;
  const c: Ball = { x: b0.x, y: b0.y, vx: b0.vx, vy: b0.vy, boost: b0.boost };
  let bounces = 0;
  const smooth = !!(env.drag || env.pulls?.length);
  let pvx = c.vx;
  let pvy = c.vy;
  for (let t = 0; t < horizon; t += SUB) {
    const s = step(c, SUB, env, t);
    if (smooth) {
      // drag and pulls change the velocity every step: a bounce is a sudden change of direction
      const cross = pvx * c.vy - pvy * c.vx;
      const dot = pvx * c.vx + pvy * c.vy;
      if (Math.abs(cross) > 0.15 * Math.abs(dot) || dot < 0) bounces++;
      pvx = c.vx;
      pvy = c.vy;
    } else if (c.vx !== pvx || c.vy !== pvy) {
      bounces++;
      pvx = c.vx;
      pvy = c.vy;
    }
    if (s === 'out') return null;
    if (s === 'hit') return { t: t + SUB, x: c.x, vx: c.vx, vy: c.vy, bounces };
  }
  return null;
}
