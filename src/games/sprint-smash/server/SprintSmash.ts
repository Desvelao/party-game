import { circleBar } from '../../../core/shared/kit/collision';
import { clamp, nextIn, r1, r2 } from '../../../core/shared/kit/util';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../core/shared/plugin-api';
import { NO_INPUT, type GameEvent, type InputState } from '../../../core/shared/types';
import { DASH_CX, DASH_CY, DASH_INNER, DASH_MID, DASH_OUTER, DASH_ROD_HALF, DASH_ROD_LEN, inWallArc } from '../shared/geometry';
import type { DashPlayerState, DashState } from '../shared/types';
import { DASH_DEFAULTS, type DashConfig } from './config';

const TAU = Math.PI * 2;
// exported constants: the bot (bot/physics.ts) plans with them, so they cannot drift apart
export const PLAYER_R = 20;
export const TURN_RATE = 3.5; // rad/s
export const CRUISE = 170;
/** a tube reaches the track (and hurts) once it is out further than this fraction */
export const ROD_HIT = 0.3;
export const ACCEL_SPEED = 270;
export const BOOST_SPEED = 380;
const BOOST_TIME = 1.2; // s after a berry
const ENERGY_REGEN = 0.25; // per second
const KNOCK_DECAY = 4; // 1/s
/** berryBar: gauge a berry adds, and how far from the track edges a position counts as safe to fall back to */
const BERRY_LOAD = 0.5;
const SAFE_MARGIN = 20;
const SLOW_FACTOR = 0.6;
/** hitSlow: speed share while a craft crawls after a hit */
const HIT_SLOW_FACTOR = 0.35;
/** how long after the first finisher the round runs on (so the win is seen) */
const FINISH_LINGER = 1.5; // s

export const JUMP_TIME = 0.6;
export const JUMP_COOLDOWN = 0.5;

export const MISSILE_SPEED = 520; // u/s along the track
const MISSILE_LIFE = 2.5; // s
export const MISSILE_R = 30;
export const STAR_RADIUS = 110;

const BALL_COUNT = 4; // lava balls per eruption
const BALL_GAP = 0.25; // s between two launches of one eruption
const BALL_SPEED = 300; // u/s
export const BALL_R = 22;
const ERUPT_WARN = 1.0; // s

const BARREL_COUNT = 8;
export const BARREL_R = 26;
const BARREL_BACK = 5; // s until an exploded barrel returns
const SLIME_SHOW = 2.0; // s the monster is visible before throwing
const BLOB_SPEED = 230;
export const BLOB_R = 24;

/** Splash Sprint hub: 6 ports on a circle, a tube can leave from each; an event sends all six or one */
export const HUB_PORTS = 6;
const TUBE_RAMP = 1; // s to extend / retract
const TUBE_HOLD = 3; // s a tube stays out
const TUBE_LIFE = TUBE_RAMP * 2 + TUBE_HOLD;
const SET_CHANCE = 0.4; // an event sends the whole set of tubes, else one
const BURST_FACTOR = 0.25; // the interval within a sequence of events
const BURST_MIN_GAP = 1.2; // s
const ROD_SLOW = 0.8; // s a tube hit slows the craft

export const PICKUP_R = 28;

const wrapAngle = (a: number): number => {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  else if (x < -Math.PI) x += TAU;
  return x;
};

interface P {
  id: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** knock-back velocity, decays */
  kx: number;
  ky: number;
  energy: number;
  boost: number; // s left
  stun: number; // s left
  fall: number; // s left frozen after falling off the track (edgeWalls)
  safeX: number;
  safeY: number;
  safeProg: number;
  slow: number; // s left
  hitSlowT: number; // s left crawling after a hit (hitSlow)
  item: '' | 'missile' | 'star';
  airT: number; // s left in the air
  jumpCd: number;
  hitCd: number; // throttles hazard hit events
  invulnT: number; // s of hit protection left
  /** accumulated forward angle around the centre, radians */
  prog: number;
  lastAng: number;
  finishedAt: number; // -1 while racing
  prevA1: boolean;
  prevA2: boolean;
  accelerating: boolean;
  alive: boolean;
  /** disconnect order (1 = first to leave) for players who left mid-race, else 0: they place below everyone else */
  left: number;
  input: InputState;
}

interface Pickup {
  id: number;
  x: number;
  y: number;
  k: 'fruit' | 'missile' | 'star';
}
interface Missile {
  id: number;
  owner: string;
  /** angle around the centre, radians (ring missiles) */
  ang: number;
  r: number;
  life: number;
  /** straight missiles: position and velocity; `ring` ones use ang/r */
  x: number;
  y: number;
  vx: number;
  vy: number;
  ring: boolean;
  /** bounced on the wall: it can now hurt its owner too */
  bounced: boolean;
}
interface Barrel {
  x: number;
  y: number;
  back: number; // s until it returns, 0 = on
}
interface Blob {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
/** a lava ball thrown by the volcano: flies straight, over the infield wall, and drops into the lava past the outer edge */
interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class SprintSmash implements Minigame {
  readonly id: string;
  readonly name = 'Sprint Smash';

  private players: P[] = [];
  private byId = new Map<string, P>();
  private events: GameEvent[] = [];
  private t = 0;
  private finished = false;
  private leaveSeq = 0;
  private firstFinish = -1;
  private nextId = 1;

  private pickups: Pickup[] = [];
  private missiles: Missile[] = [];
  private fruitTimer = 0;
  private missileTimer = 0;
  private starTimer = 0;

  private balls: Ball[] = [];
  private launchLeft = 0; // balls still to launch in this eruption
  private launchT = 0;
  private eruptTimer = 0;
  private eruptWarn = 0;

  private barrels: Barrel[] = [];
  private slimeTimer = 0;
  private slimeLeft = 0;
  private slimeBase = 0;
  private blobs: Blob[] = [];

  private rodAngle = 0;
  /** seconds since each tube started leaving its port, -1 = in */
  private tubeT: number[] = new Array(HUB_PORTS).fill(-1);
  private rodTimer = 0;
  private burstLeft = 0;

  constructor(
    private readonly cfg: DashConfig = DASH_DEFAULTS,
    private readonly rng: () => number = Math.random,
  ) {
    this.id = cfg.variant;
  }

  init(players: MinigamePlayer[]): void {
    const cfg = this.cfg;
    this.players = [];
    this.byId.clear();
    this.events = [];
    this.t = 0;
    this.finished = false;
    this.leaveSeq = 0;
    this.firstFinish = -1;
    this.nextId = 1;
    this.pickups = [];
    this.missiles = [];
    this.balls = [];
    this.launchLeft = 0;
    this.launchT = 0;
    this.blobs = [];
    this.fruitTimer = nextIn(this.rng, cfg.fruitEvery, cfg.fruitVariance);
    this.missileTimer = nextIn(this.rng, cfg.missileEvery, cfg.missileVariance);
    this.starTimer = nextIn(this.rng, cfg.starEvery, cfg.starVariance);
    this.eruptTimer = nextIn(this.rng, cfg.eruptEvery, cfg.eruptVariance);
    this.eruptWarn = 0;
    this.slimeTimer = nextIn(this.rng, cfg.slimeEvery, cfg.slimeVariance);
    this.slimeLeft = 0;
    this.rodAngle = 0;
    this.tubeT = new Array(HUB_PORTS).fill(-1);
    this.rodTimer = nextIn(this.rng, cfg.rodEvery, cfg.rodVariance);
    this.burstLeft = 0;
    this.barrels = cfg.toxic ? Array.from({ length: BARREL_COUNT }, () => ({ x: 0, y: 0, back: 0 })) : [];
    for (const b of this.barrels) this.placeBarrel(b, false);

    players.forEach((pl, i) => {
      // a staggered grid just behind the start line (angle 0), alternating lanes
      const ang = -0.09 - i * 0.12;
      const r = DASH_MID + (i % 2 === 0 ? -34 : 34);
      const p: P = {
        id: pl.id,
        x: DASH_CX + Math.cos(ang) * r,
        y: DASH_CY + Math.sin(ang) * r,
        heading: ang + Math.PI / 2, // clockwise on screen
        speed: 0,
        kx: 0,
        ky: 0,
        energy: cfg.berryBar ? 0 : 1,
        boost: 0,
        invulnT: 0,
        stun: 0,
        fall: 0,
        safeX: DASH_CX + Math.cos(ang) * r,
        safeY: DASH_CY + Math.sin(ang) * r,
        safeProg: 0,
        slow: 0,
        hitSlowT: 0,
        item: '',
        airT: 0,
        jumpCd: 0,
        hitCd: 0,
        prog: 0,
        lastAng: ang,
        finishedAt: -1,
        prevA1: false,
        prevA2: false,
        accelerating: false,
        alive: true,
        left: 0,
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
    if (p) {
      if (p.alive && p.finishedAt < 0) p.left = ++this.leaveSeq;
      p.alive = false;
      p.input = NO_INPUT;
    }
  }

  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;

    this.stepSpawns(dt);
    this.stepHazards(dt);
    for (const p of this.players) if (p.alive && p.finishedAt < 0) this.stepPlayer(p, dt);
    this.resolveBumps();
    this.stepPickups();
    this.stepMissiles(dt);
    this.stepHazardHits();

    for (const p of this.players) {
      if (p.alive && p.finishedAt < 0 && p.prog >= this.cfg.laps * TAU) {
        p.finishedAt = this.t;
        if (this.firstFinish < 0) this.firstFinish = this.t;
        this.events.push({ kind: 'bank', id: p.id, x: r1(p.x), y: r1(p.y) });
      }
    }
    const racing = this.players.some((p) => p.alive && p.finishedAt < 0);
    const lingering = this.firstFinish >= 0 && this.t >= this.firstFinish + FINISH_LINGER;
    if (this.t >= this.cfg.timeLimit || !racing || lingering) this.finished = true;
  }

  // ---- spawning ---------------------------------------------------------

  private trackPoint(): { x: number; y: number } {
    const a = this.rng() * TAU;
    const r = DASH_MID + (this.rng() * 2 - 1) * 45;
    return { x: DASH_CX + Math.cos(a) * r, y: DASH_CY + Math.sin(a) * r };
  }

  /** the volcano throws a ball at a random racing craft (where it will be), a little off so it can be dodged */
  private launchBall(): void {
    const racers = this.players.filter((p) => p.alive && p.finishedAt < 0 && p.fall === 0);
    let ang = this.rng() * TAU;
    if (racers.length) {
      const t = racers[Math.floor(this.rng() * racers.length)];
      const flight = Math.hypot(t.x - DASH_CX, t.y - DASH_CY) / BALL_SPEED;
      const tx = t.x + Math.cos(t.heading) * t.speed * flight - DASH_CX;
      const ty = t.y + Math.sin(t.heading) * t.speed * flight - DASH_CY;
      ang = Math.atan2(ty, tx) + (this.rng() * 2 - 1) * 0.3;
    }
    this.balls.push({ id: this.nextId++, x: DASH_CX, y: DASH_CY, vx: Math.cos(ang) * BALL_SPEED, vy: Math.sin(ang) * BALL_SPEED });
    this.events.push({ kind: 'rocket', id: '', x: DASH_CX, y: DASH_CY });
  }

  /** a barrel at a random track point (a returning one keeps clear of the crafts) */
  private placeBarrel(b: Barrel, avoidCrafts: boolean): void {
    for (let tries = 0; tries < 8; tries++) {
      const { x, y } = this.trackPoint();
      b.x = x;
      b.y = y;
      if (!avoidCrafts || !this.players.some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < 90)) return;
    }
  }

  private spawnPickup(k: Pickup['k']): void {
    const { x, y } = this.trackPoint();
    this.pickups.push({ id: this.nextId++, x, y, k });
  }

  private stepSpawns(dt: number): void {
    const cfg = this.cfg;
    this.fruitTimer -= dt;
    if (this.fruitTimer <= 0) {
      this.fruitTimer = nextIn(this.rng, cfg.fruitEvery, cfg.fruitVariance);
      if (this.pickups.filter((p) => p.k === 'fruit').length < cfg.fruitMax) this.spawnPickup('fruit');
    }
    if (cfg.missiles) {
      this.missileTimer -= dt;
      if (this.missileTimer <= 0) {
        this.missileTimer = nextIn(this.rng, cfg.missileEvery, cfg.missileVariance);
        if (this.pickups.filter((p) => p.k === 'missile').length < cfg.missileMax) this.spawnPickup('missile');
      }
    }
    if (cfg.toxic) {
      this.starTimer -= dt;
      if (this.starTimer <= 0) {
        this.starTimer = nextIn(this.rng, cfg.starEvery, cfg.starVariance);
        if (this.pickups.filter((p) => p.k === 'star').length < cfg.starMax) this.spawnPickup('star');
      }
    }
  }

  // ---- arena hazards that move on their own --------------------------------

  /** how far tube `k` is out of its port, 0..1 */
  private tubeExt(k: number): number {
    const ph = this.tubeT[k];
    if (ph < 0) return 0;
    if (ph < TUBE_RAMP) return ph / TUBE_RAMP;
    if (ph < TUBE_RAMP + TUBE_HOLD) return 1;
    return Math.max(0, 1 - (ph - TUBE_RAMP - TUBE_HOLD) / TUBE_RAMP);
  }

  /** a hub event: the whole set of tubes or one concrete tube leaves (one already out stays out, its timer restarts) */
  private startTubes(): void {
    const ks = this.rng() < SET_CHANCE ? Array.from({ length: HUB_PORTS }, (_, i) => i) : [Math.floor(this.rng() * HUB_PORTS)];
    for (const k of ks) this.tubeT[k] = this.tubeT[k] < 0 ? 0 : Math.min(this.tubeT[k], TUBE_RAMP);
  }

  private stepHub(dt: number): void {
    const cfg = this.cfg;
    let out = false;
    for (let k = 0; k < HUB_PORTS; k++) {
      if (this.tubeT[k] < 0) continue;
      this.tubeT[k] += dt;
      if (this.tubeT[k] >= TUBE_LIFE) this.tubeT[k] = -1;
      else out = true;
    }
    // the hub turns against the lap direction (laps run towards increasing angle), only while a tube is out
    if (out) this.rodAngle -= cfg.rodSpeed * dt; // not wrapped: the client interpolates it
    this.rodTimer -= dt;
    if (this.rodTimer > 0) return;
    this.startTubes();
    let gap = nextIn(this.rng, cfg.rodEvery, cfg.rodVariance);
    if (this.burstLeft > 0) {
      this.burstLeft--;
      gap = Math.max(BURST_MIN_GAP, gap * BURST_FACTOR);
    } else if (cfg.rodBurst > 0 && this.rng() * 100 < cfg.rodBurst) {
      this.burstLeft = 2 + Math.floor(this.rng() * 3); // 3 to 5 events in all
      gap = Math.max(BURST_MIN_GAP, gap * BURST_FACTOR);
    }
    this.rodTimer = gap;
  }

  private stepHazards(dt: number): void {
    const cfg = this.cfg;
    for (const p of this.players) p.hitCd = Math.max(0, p.hitCd - dt);

    if (cfg.rods) this.stepHub(dt);

    if (cfg.volcano) {
      if (this.eruptWarn > 0) {
        this.eruptWarn -= dt;
        if (this.eruptWarn <= 0) {
          this.eruptWarn = 0;
          this.events.push({ kind: 'boom', id: '', x: DASH_CX, y: DASH_CY });
          this.launchLeft = BALL_COUNT;
          this.launchT = 0;
        }
      } else {
        this.eruptTimer -= dt;
        if (this.eruptTimer <= 0) {
          this.eruptTimer = nextIn(this.rng, cfg.eruptEvery, cfg.eruptVariance);
          this.eruptWarn = ERUPT_WARN;
        }
      }
      if (this.launchLeft > 0) {
        this.launchT -= dt;
        if (this.launchT <= 0) {
          this.launchT = BALL_GAP;
          this.launchLeft--;
          this.launchBall();
        }
      }
      for (const b of this.balls) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      this.balls = this.balls.filter((b) => Math.hypot(b.x - DASH_CX, b.y - DASH_CY) < DASH_OUTER + 30);
    }

    if (cfg.toxic) {
      for (const b of this.barrels) {
        if (b.back <= 0) continue;
        b.back = Math.max(0, b.back - dt);
        if (b.back === 0) this.placeBarrel(b, true); // it comes back somewhere else
      }
      if (this.slimeLeft > 0) {
        this.slimeLeft -= dt;
        if (this.slimeLeft <= 0) {
          this.slimeLeft = 0;
          this.events.push({ kind: 'boom', id: '', x: DASH_CX, y: DASH_CY });
          for (let i = 0; i < 3; i++) {
            const a = this.slimeBase + (i / 3) * TAU;
            this.blobs.push({ id: this.nextId++, x: DASH_CX, y: DASH_CY, vx: Math.cos(a) * BLOB_SPEED, vy: Math.sin(a) * BLOB_SPEED });
          }
        }
      } else {
        this.slimeTimer -= dt;
        if (this.slimeTimer <= 0) {
          this.slimeTimer = nextIn(this.rng, cfg.slimeEvery, cfg.slimeVariance);
          this.slimeLeft = SLIME_SHOW;
          this.slimeBase = this.rng() * TAU;
        }
      }
      for (const b of this.blobs) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      this.blobs = this.blobs.filter((b) => Math.hypot(b.x - DASH_CX, b.y - DASH_CY) < DASH_OUTER + 40);
    }
  }

  // ---- the craft ------------------------------------------------------------

  private stepPlayer(p: P, dt: number): void {
    const cfg = this.cfg;
    p.jumpCd = Math.max(0, p.jumpCd - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.slow = Math.max(0, p.slow - dt);
    p.hitSlowT = Math.max(0, p.hitSlowT - dt);
    p.boost = Math.max(0, p.boost - dt);
    const wasAir = p.airT > 0;
    p.airT = Math.max(0, p.airT - dt);
    if (wasAir && p.airT === 0) this.events.push({ kind: 'splash', id: p.id, x: r1(p.x), y: r1(p.y) });

    if (p.fall > 0) {
      // fallen off the track: frozen out of play, then back on the last safe spot, heading along the track
      p.fall -= dt;
      p.speed = p.kx = p.ky = 0;
      p.accelerating = false;
      p.prevA1 = p.input.a1;
      p.prevA2 = p.input.a2;
      if (p.fall <= 0) {
        p.fall = 0;
        p.x = p.safeX;
        p.y = p.safeY;
        p.prog = p.safeProg;
        p.lastAng = Math.atan2(p.y - DASH_CY, p.x - DASH_CX);
        p.heading = p.lastAng + Math.PI / 2;
        p.invulnT = Math.max(p.invulnT, cfg.invulnTime);
      }
      return;
    }

    const { mx, my, a1, a2 } = p.input;
    const stunned = p.stun > 0;
    const len = Math.hypot(mx, my);

    // steer: the stick gives the heading the craft turns towards
    if (!stunned && len > 0.2) {
      const diff = wrapAngle(Math.atan2(my, mx) - p.heading);
      p.heading += clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
    }

    // hold = accelerate while the gauge lasts; it refills otherwise (berryBar: only berries fill it)
    p.accelerating = !stunned && a1 && p.energy > 0;
    if (p.accelerating) p.energy = Math.max(0, p.energy - cfg.energyDrain * dt);
    else if (!cfg.berryBar) p.energy = Math.min(1, p.energy + ENERGY_REGEN * dt);

    // press edge: use the held item / jump (item2: on a2, a1 is only the throttle)
    const fire = cfg.item2 ? a2 && !p.prevA2 : a1 && !p.prevA1;
    if (fire && !stunned) this.useItem(p);
    p.prevA1 = a1;
    p.prevA2 = a2;

    let target = p.boost > 0 || (cfg.berryBar && p.accelerating) ? BOOST_SPEED : p.accelerating ? ACCEL_SPEED : CRUISE;
    if (p.slow > 0) target *= SLOW_FACTOR;
    if (p.hitSlowT > 0) target *= HIT_SLOW_FACTOR;
    if (stunned) target = 0;
    p.speed += (target - p.speed) * Math.min(1, 6 * dt);

    p.x += (Math.cos(p.heading) * p.speed + p.kx) * dt;
    p.y += (Math.sin(p.heading) * p.speed + p.ky) * dt;
    const kd = Math.exp(-KNOCK_DECAY * dt);
    p.kx *= kd;
    p.ky *= kd;
    if (Math.abs(p.kx) + Math.abs(p.ky) < 1) p.kx = p.ky = 0;

    // the walls: slide along them and lose a little speed
    const dx = p.x - DASH_CX;
    const dy = p.y - DASH_CY;
    const r = Math.hypot(dx, dy) || 1;
    const lo = DASH_INNER + PLAYER_R * 0.6;
    const hi = DASH_OUTER - PLAYER_R * 0.6;
    const edgeWalls = cfg.edgeWalls;
    // edgeWalls: the inner edge is always a wall; of the outer edge only the top arc is (`outerArc`, Dot Sprint), the rest is open
    const walled = !edgeWalls ? r < lo || r > hi : r < lo || (r > hi && cfg.outerArc && inWallArc(Math.atan2(dy, dx)));
    if (walled) {
      const rr = clamp(r, lo, hi);
      p.x = DASH_CX + (dx / r) * rr;
      p.y = DASH_CY + (dy / r) * rr;
      p.speed *= 0.97;
      // remove the part of the knock that points into the wall
      const nx = dx / r;
      const ny = dy / r;
      const into = p.kx * nx + p.ky * ny;
      if ((r > hi && into > 0) || (r < lo && into < 0)) {
        p.kx -= into * nx;
        p.ky -= into * ny;
      }
    }

    if (edgeWalls) {
      const rr = Math.hypot(p.x - DASH_CX, p.y - DASH_CY);
      if (rr > DASH_OUTER && p.airT === 0) {
        p.fall = nextIn(this.rng, cfg.fallPenalty, cfg.fallPenaltyVariance, 0.5);
        p.speed = p.kx = p.ky = 0;
        this.events.push({ kind: 'splash', id: p.id, x: r1(p.x), y: r1(p.y) });
        return;
      }
      if (rr > DASH_INNER + SAFE_MARGIN && rr < DASH_OUTER - SAFE_MARGIN) {
        p.safeX = p.x;
        p.safeY = p.y;
        p.safeProg = p.prog;
      }
    }

    // lap progress: accumulated forward angle
    const ang = Math.atan2(p.y - DASH_CY, p.x - DASH_CX);
    p.prog += wrapAngle(ang - p.lastAng);
    p.lastAng = ang;
  }

  private useItem(p: P): void {
    if (p.item === 'missile') {
      p.item = '';
      const ang = Math.atan2(p.y - DASH_CY, p.x - DASH_CX);
      const r = clamp(Math.hypot(p.x - DASH_CX, p.y - DASH_CY), DASH_INNER + 20, DASH_OUTER - 20);
      const straight = this.cfg.straightMissiles;
      const hx = Math.cos(p.heading);
      const hy = Math.sin(p.heading);
      this.missiles.push({
        id: this.nextId++,
        owner: p.id,
        ang: ang + 0.12,
        r,
        life: MISSILE_LIFE,
        ring: !straight,
        x: p.x + hx * (PLAYER_R + 6),
        y: p.y + hy * (PLAYER_R + 6),
        vx: hx * MISSILE_SPEED,
        vy: hy * MISSILE_SPEED,
        bounced: false,
      });
      this.events.push({ kind: 'rocket', id: p.id, x: r1(p.x), y: r1(p.y) });
    } else if (p.item === 'star') {
      p.item = '';
      this.events.push({ kind: 'zap', id: p.id, x: r1(p.x), y: r1(p.y) });
      for (const o of this.players) {
        if (o === p || !o.alive || o.finishedAt >= 0) continue;
        const dx = o.x - p.x;
        const dy = o.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d >= STAR_RADIUS) continue;
        const nx = d < 1 ? 1 : dx / d;
        const ny = d < 1 ? 0 : dy / d;
        if (o.invulnT > 0) continue;
        o.invulnT = this.cfg.invulnTime;
        o.kx += nx * 420;
        o.ky += ny * 420;
        o.stun = Math.max(o.stun, 0.35);
      }
    } else if (this.cfg.rods && p.jumpCd <= 0 && p.airT <= 0) {
      p.airT = JUMP_TIME;
      p.jumpCd = JUMP_TIME + JUMP_COOLDOWN;
      this.events.push({ kind: 'ext:sprint-smash', id: p.id, x: r1(p.x), y: r1(p.y) });
    }
  }

  /** `protect` false = continuous hazard (lava): not gated by, and does not start, hit protection */
  private knock(p: P, nx: number, ny: number, force: number, stun: number, kind: GameEvent['kind'], protect = true): void {
    if (protect) {
      if (p.invulnT > 0) return;
      p.invulnT = this.cfg.invulnTime;
    }
    p.kx += nx * force;
    p.ky += ny * force;
    p.stun = Math.max(p.stun, stun);
    p.speed *= 0.5;
    if (protect && this.cfg.hitSlow > 0) p.hitSlowT = Math.max(p.hitSlowT, nextIn(this.rng, this.cfg.hitSlow, this.cfg.hitSlowVariance, 0.5));
    if (p.hitCd <= 0) {
      p.hitCd = 0.4;
      this.events.push({ kind, id: p.id, x: r1(p.x), y: r1(p.y) });
    }
  }

  private resolveBumps(): void {
    const ps = this.players.filter((p) => p.alive && p.finishedAt < 0 && p.airT === 0 && p.fall === 0);
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
        const nx = dx / d;
        const ny = dy / d;
        const push = (minDist - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        // an accelerating craft shoves the other one away
        let bumped = false;
        if ((a.accelerating || a.boost > 0) && b.invulnT <= 0) {
          b.invulnT = this.cfg.invulnTime;
          b.kx += nx * 260;
          b.ky += ny * 260;
          b.stun = Math.max(b.stun, 0.25);
          bumped = true;
        }
        if ((b.accelerating || b.boost > 0) && a.invulnT <= 0) {
          a.invulnT = this.cfg.invulnTime;
          a.kx -= nx * 260;
          a.ky -= ny * 260;
          a.stun = Math.max(a.stun, 0.25);
          bumped = true;
        }
        if (bumped) this.events.push({ kind: 'bump', id: a.id, x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2) });
      }
    }
  }

  private stepPickups(): void {
    for (const p of this.players) {
      if (!p.alive || p.finishedAt >= 0 || p.fall > 0) continue;
      for (const k of this.pickups) {
        if (Math.hypot(k.x - p.x, k.y - p.y) > PICKUP_R + PLAYER_R * 0.5) continue;
        if (k.k === 'fruit') {
          if (this.cfg.berryBar) {
            p.energy = Math.min(1, p.energy + BERRY_LOAD);
          } else {
            p.energy = 1;
            p.boost = BOOST_TIME;
          }
        } else if (p.item === '') {
          p.item = k.k;
        } else {
          continue; // already holding something: leave it
        }
        k.id = -1;
        this.events.push({ kind: 'pickup', id: p.id, x: r1(k.x), y: r1(k.y) });
      }
    }
    this.pickups = this.pickups.filter((k) => k.id !== -1);
  }

  private stepMissiles(dt: number): void {
    const out: Missile[] = [];
    for (const m of this.missiles) {
      m.life -= dt;
      if (m.ring) m.ang += (MISSILE_SPEED / m.r) * dt;
      else {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const dx = m.x - DASH_CX;
        const dy = m.y - DASH_CY;
        const d = Math.hypot(dx, dy) || 1;
        const outerWall = this.cfg.outerArc && d > DASH_OUTER - 8 && inWallArc(Math.atan2(dy, dx));
        if (outerWall || d < DASH_INNER + 8) {
          // bounce on the top outer wall or the inner wall: mirror the velocity about the wall normal
          const nx = dx / d;
          const ny = dy / d;
          const dot = m.vx * nx + m.vy * ny; // speed along the outward normal
          if (outerWall ? dot > 0 : dot < 0) {
            m.vx -= 2 * dot * nx;
            m.vy -= 2 * dot * ny;
            m.bounced = true;
          }
          const rr = outerWall ? DASH_OUTER - 8 : DASH_INNER + 8;
          m.x = DASH_CX + nx * rr;
          m.y = DASH_CY + ny * rr;
        } else if (d > DASH_OUTER + 10) {
          m.life = 0; // left the track over the open edge
        }
      }
      const mx = m.ring ? DASH_CX + Math.cos(m.ang) * m.r : m.x;
      const my = m.ring ? DASH_CY + Math.sin(m.ang) * m.r : m.y;
      let hit = false;
      for (const p of this.players) {
        if (!p.alive || (p.id === m.owner && !m.bounced) || p.finishedAt >= 0 || p.airT > 0 || p.fall > 0) continue;
        if (Math.hypot(p.x - mx, p.y - my) > MISSILE_R) continue;
        // pushed the way the missile was going
        const sp = Math.hypot(m.vx, m.vy) || 1;
        const tx = m.ring ? -Math.sin(m.ang) : m.vx / sp;
        const ty = m.ring ? Math.cos(m.ang) : m.vy / sp;
        this.knock(p, tx, ty, 360, 0.6, 'hit');
        hit = true;
        break;
      }
      if (!hit && m.life > 0) out.push(m);
    }
    this.missiles = out;
  }

  /** Lava, barrels, slime blobs and rods. */
  private stepHazardHits(): void {
    const cfg = this.cfg;
    for (const p of this.players) {
      if (!p.alive || p.finishedAt >= 0) continue;
      const grounded = p.airT === 0;

      // lava balls: a hit knocks, stuns and (hitSlow) slows; over the infield wall they hurt nobody
      if (grounded && p.fall === 0) {
        for (const b of this.balls) {
          const rb = Math.hypot(b.x - DASH_CX, b.y - DASH_CY);
          if (rb < DASH_INNER || rb > DASH_OUTER) continue;
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > BALL_R + PLAYER_R * 0.5) continue;
          this.knock(p, d < 1 ? 1 : dx / d, d < 1 ? 0 : dy / d, 330, 0.3, 'hit');
          b.x = DASH_CX + 1e4; // spent: dropped by the filter
        }
      }

      if (cfg.toxic) {
        for (const b of this.barrels) {
          if (b.back > 0) continue;
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > BARREL_R + PLAYER_R * 0.5) continue;
          b.back = BARREL_BACK;
          p.slow = Math.max(p.slow, 0.8);
          this.knock(p, d < 1 ? 0 : dx / d, d < 1 ? -1 : dy / d, 320, 0.3, 'boom');
        }
        for (const bl of this.blobs) {
          if (Math.hypot(p.x - bl.x, p.y - bl.y) > BLOB_R + PLAYER_R * 0.5) continue;
          const sp = Math.hypot(bl.vx, bl.vy) || 1;
          this.knock(p, bl.vx / sp, bl.vy / sp, 340, 0.3, 'hit');
        }
      }

      if (cfg.rods && grounded && p.fall === 0) {
        for (let k = 0; k < HUB_PORTS; k++) {
          const ext = this.tubeExt(k);
          if (ext > ROD_HIT) {
            const c = circleBar(p.x, p.y, PLAYER_R, DASH_CX, DASH_CY, this.rodAngle + (k * TAU) / HUB_PORTS, DASH_ROD_LEN * ext, DASH_ROD_HALF);
            if (!c.hit) continue;
            // the tube sweeps through the craft (pushing it out of the bar would carry it along at the tube's speed, a free ride
            // with the race): a knock instead, in the way the tube is moving (against the lap: it costs ground, and it never
            // throws the craft over the open outer edge), and a slowdown; hit protection stops a second hit as it passes
            const dx = p.x - DASH_CX;
            const dy = p.y - DASH_CY;
            const d = Math.hypot(dx, dy) || 1;
            p.slow = Math.max(p.slow, ROD_SLOW);
            this.knock(p, dy / d, -dx / d, 300, 0.3, 'hit');
          }
        }
      }
    }
  }

  // ---- output ---------------------------------------------------------------

  getState(): DashState {
    const cfg = this.cfg;
    const players: DashPlayerState[] = this.players.map((p) => ({
      id: p.id,
      x: r1(p.x),
      y: r1(p.y),
      f: r2(p.heading),
      p: r2(Math.max(0, p.prog) / TAU),
      e: r2(p.energy),
      item: p.item,
      air: p.airT > 0 ? r2(1 - p.airT / JUMP_TIME) : 0,
      stun: p.stun > 0,
      fall: p.fall > 0,
      slow: p.hitSlowT > 0,
      boost: p.hitSlowT <= 0 && (p.boost > 0 || (cfg.berryBar && p.accelerating)),
      inv: p.invulnT > 0,
      fin: p.finishedAt >= 0,
    }));
    const s: DashState = {
      kind: 'ext:sprint-smash',
      variant: cfg.variant,
      t: r1(this.t),
      limit: cfg.timeLimit,
      laps: cfg.laps,
      players,
      pickups: this.pickups.map((k) => ({ id: k.id, x: r1(k.x), y: r1(k.y), k: k.k })),
      missiles: this.missiles.map((m) =>
        m.ring
          ? { id: m.id, x: r1(DASH_CX + Math.cos(m.ang) * m.r), y: r1(DASH_CY + Math.sin(m.ang) * m.r), a: r2(m.ang + Math.PI / 2) }
          : { id: m.id, x: r1(m.x), y: r1(m.y), vx: r1(m.vx), vy: r1(m.vy), a: r2(Math.atan2(m.vy, m.vx)) },
      ),
    };
    if (cfg.toxic) {
      s.barrels = this.barrels.map((b) => ({ x: r1(b.x), y: r1(b.y), on: b.back === 0 }));
      s.slime = { t: this.slimeLeft > 0 ? r2(1 - this.slimeLeft / SLIME_SHOW) : 0 };
      s.blobs = this.blobs.map((b) => ({ id: b.id, x: r1(b.x), y: r1(b.y) }));
    }
    if (cfg.volcano) {
      s.volcano = { warn: this.eruptWarn > 0 ? r2(this.eruptWarn / ERUPT_WARN) : 0 };
      s.balls = this.balls.map((b) => ({ id: b.id, x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy) }));
    }
    if (cfg.rods) s.rods = { a: r2(this.rodAngle), tubes: this.tubeT.map((_, k) => r2(this.tubeExt(k))) };
    return s;
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
    // finishers by time; then those still connected by how far round they got; then leavers, latest leaver first
    const key = (p: P): [number, number] =>
      p.finishedAt >= 0 ? [0, p.finishedAt] : p.left > 0 ? [2, -p.left] : [1, -Math.round(Math.max(0, p.prog) * 100) / 100];
    const sorted = [...this.players].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
    let place = 0;
    return sorted.map((p, i) => {
      const k = key(p);
      const prev = i > 0 ? key(sorted[i - 1]) : null;
      if (!prev || prev[0] !== k[0] || prev[1] !== k[1]) place = i + 1;
      return { id: p.id, place };
    });
  }
}
