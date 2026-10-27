import { WORLD_SIZE } from '../../../core/shared/constants';
import { LastStandingTracker, nextIn, r1, r2, smoothstep } from '../../../core/shared/kit/util';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../core/shared/plugin-api';
import { NO_INPUT, type GameEvent, type InputState } from '../../../core/shared/types';
import { polarEdge } from '../shared/geometry';
import type { PolarPlayerState, FrostShoveState } from '../shared/types';
import { POLAR_DEFAULTS, type PolarConfig } from './config';

const CENTER = WORLD_SIZE / 2;
// exported constants: the bot (bot/physics.ts) predicts with them, so they cannot drift apart
export const START_RADIUS = 400;
export const MIN_RADIUS = 130;
const SECTORS = 16;

export const BASE_R = 26;
export const ACCEL = 1300;
export const MAX_SPEED = 280;
export const FRICTION = 2.4; // 1/s: the ice is slippery
export const DASH_SPEED = 760;
export const DASH_TIME = 0.2;
export const DASH_COST = 0.5;
export const BOUNCE = 1.1;
export const DASH_PUSH = 300;

// Past the rim slower than this (outward, px/s) a bear hangs on the edge and can climb back; faster, it plunges for good.
// Walking tops out at 280 (378 with a speed box); dash hits, bolts and bombs are well above.
export const LEDGE_SPEED = 400;

// The wall of ice slices (Frost Classic): one slice per ice sector, riding the rim. It stops bears; a hit harder than
// WALL_BREAK_SPEED (a dash, or a bear flung by one) breaks the slice and the bear carries on through the gap.
export const WALL_SLICES = SECTORS;
export const WALL_BREAK_SPEED = 450;
export const WALL_BOUNCE = 0.5;
export const WALL_INNER = 14; // px: the slices' inner face is this far inside the rim (the client draws them from -14 to +12)
const WALL_KEEP = 0.6; // share of its speed a bear keeps after breaking a slice

// Tip Tumble's walrus: a fish jumps onto the ice near the edge, the walrus comes in from the same side, its weight tips
// the floe, it takes the fish and goes back into the water. It does not touch the bears.
export const FISH_TIME = 1.6;
export const WALRUS_IN = 1.4;
export const WALRUS_EAT = 2.0;
export const WALRUS_OUT = 1.2;
export const WALRUS_TILT = 0.8; // tilt (of 1) at full weight
export const FISH_INSET = 70; // px from the edge
export const WALRUS_INSET = 55;
const WALRUS_MIN_GAP = 5; // s
const WALRUS_MIN_FLOE = 200; // no visit when the floe is smaller than this

export const CLIMB_TIME = 1.4; // s in the water before it is too late
export const CLIMB_PER_PRESS = 0.2;

export const ITEM_R = 22;
const MAX_ITEMS = 2;
const EFFECT_TIME = 6;
const FREEZE_TIME = 1.6;

export const BOLT_WARN = 1.0;
export const BOLT_ON = 0.35;
export const BOLT_HALF = 16;
export const BOLT_KNOCK = 620;
const BOLT_STUN = 0.7;

export const BOMB_SPEED = 560;
export const BOMB_LIFE = 0.9;
export const BOMB_BLAST = 80;
export const BOMB_KNOCK = 700;
const DISMOUNT_TIME = 6;

// Lightning and Weight are passed on by touch (a bomb-tag style carry): a countdown runs on the holder
export const CARRY_TIME = 10;
export const LIGHTNING_STUN = 6;
export const PASS_COOLDOWN = 0.5; // the new holder cannot hand it straight back

// The power-up dispenser (a robot; Gruff in Thaw Frenzy) orbits outside the floe, flies over it, lights a beam on the ice
// and gives a random power-up to the first bear that walks into it.
export const BEAM_R = 55;
export const BEAM_FLY = 1.2;
export const BEAM_AIM = 1.0;
export const BEAM_TIME = 6;
export const BEAM_BACK = 1.0;
const ORBIT_SPEED = 0.5; // rad/s
const ORBIT_GAP = 90; // px outside the rim
const BEAM_SPOT_INSET = 60; // px: the spot is at least this far inside the rim

// Thaw Frenzy: Gruff flies to the rim, a glowing crack warns, then he melts a bite out of it
export const MELT_WARN = 1.5;
const MELT_MIN_GAP = 2; // s
const MELT_INSET = 10; // px: the mask hovers this far inside the rim

type Effect = '' | 'speed' | 'giant' | 'shrink' | 'freeze' | 'dismounted';
type Carry = '' | 'lightning' | 'weight';
/** what a box can hold: a timed effect, or an item to carry */
type BoxFx = Exclude<Effect, '' | 'dismounted'> | Exclude<Carry, ''>;
const GOOD: BoxFx[] = ['speed', 'giant'];
const BAD: BoxFx[] = ['shrink', 'freeze'];
const CARRIED: BoxFx[] = ['lightning', 'weight'];
/** Frost Classic's robot beam: grow or shrink, or Lightning or Weight */
const BEAM: BoxFx[] = ['giant', 'shrink'];

interface P {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  alive: boolean;
  stamina: number;
  dashT: number;
  stun: number;
  /** hit protection (bolts, bombs) */
  invulnT: number;
  fx: Effect;
  fxT: number;
  /** Lightning or Weight in hand, with the seconds left on its countdown and on the pass cooldown */
  carry: Carry;
  carryT: number;
  passT: number;
  /** seconds left in the water; 0 = on the ice */
  fallT: number;
  climb: number;
  holdingBomb: boolean;
  hits: number;
  prevA1: boolean;
  elimOrder: number;
  input: InputState;
}

interface Item {
  id: number;
  x: number;
  y: number;
  k: 'bomb';
}

interface Beam {
  ph: 'idle' | 'fly' | 'aim' | 'on' | 'melt' | 'back';
  /** what the dispenser is up to, and the rim sector it is melting */
  task: 'beam' | 'melt';
  mi: number;
  t: number;
  /** where the dispenser is, where it flew from, and the beam spot */
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  sx: number;
  sy: number;
}

interface Bolt {
  a: number;
  d: number;
  t: number; // seconds since spawn
}

interface Flying {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  owner: string;
}


export class FrostShove implements Minigame {
  readonly id: string;
  readonly name = 'Frost Shove';

  private players: P[] = [];
  private byId = new Map<string, P>();
  private events: GameEvent[] = [];
  private t = 0;
  private ice: number[] = [];
  private globalR = START_RADIUS;
  private items: Item[] = [];
  private bolts: Bolt[] = [];
  private wall = 0;
  private flying: Flying[] = [];
  private nextId = 1;
  private beam: Beam = { ph: 'idle', task: 'beam', mi: 0, t: 0, x: 0, y: 0, fromX: 0, fromY: 0, sx: 0, sy: 0 };
  private beamTimer = 0;
  private orbitA = 0;
  private meltTimer = 0;
  private boltTimer = 0;
  private bombTimer = 0;
  private tilt = { x: 0, y: 0 };
  private walrus: { ph: 'fish' | 'in' | 'eat' | 'out'; t: number; a: number } | null = null;
  private walrusTimer = 0;
  private standing = new LastStandingTracker(0);
  private finished = false;

  constructor(
    private readonly cfg: PolarConfig = POLAR_DEFAULTS,
    private readonly rng: () => number = Math.random,
  ) {
    this.id = cfg.variant;
  }

  init(players: MinigamePlayer[]): void {
    this.players = [];
    this.byId.clear();
    this.events = [];
    this.t = 0;
    this.ice = new Array<number>(SECTORS).fill(START_RADIUS);
    this.globalR = START_RADIUS;
    this.items = [];
    this.bolts = [];
    this.wall = this.cfg.wall ? (1 << WALL_SLICES) - 1 : 0;
    this.flying = [];
    this.nextId = 1;
    this.beamTimer = this.cfg.itemEvery * 0.5;
    this.orbitA = this.rng() * Math.PI * 2;
    this.beam = { ph: 'idle', task: 'beam', mi: 0, t: 0, x: 0, y: 0, fromX: 0, fromY: 0, sx: 0, sy: 0 };
    this.meltTimer = this.cfg.meltEvery * 0.5;
    this.boltTimer = this.cfg.boltEvery;
    this.bombTimer = this.cfg.bombEvery * 0.5;
    this.tilt = { x: 0, y: 0 };
    this.walrus = null;
    this.walrusTimer = this.cfg.walrusEvery * 0.5;
    this.finished = false;
    this.standing = new LastStandingTracker(players.length);

    const n = players.length;
    players.forEach((pl, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = START_RADIUS * 0.55;
      const p: P = {
        id: pl.id,
        x: CENTER + Math.cos(a) * r,
        y: CENTER + Math.sin(a) * r,
        vx: 0,
        vy: 0,
        facing: a + Math.PI,
        alive: true,
        stamina: 1,
        dashT: 0,
        stun: 0,
        invulnT: 0,
        fx: '',
        fxT: 0,
        carry: '',
        carryT: 0,
        passT: 0,
        fallT: 0,
        climb: 0,
        holdingBomb: false,
        hits: 0,
        prevA1: false,
        elimOrder: 0,
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
    if (p && p.alive) this.eliminate(p);
  }

  // ---- effect modifiers ---------------------------------------------------
  private radiusOf(p: P): number {
    return p.fx === 'giant' ? BASE_R * 1.5 : p.fx === 'shrink' ? BASE_R * 0.7 : BASE_R;
  }
  private massOf(p: P): number {
    return p.fx === 'giant' ? 2.4 : p.fx === 'shrink' ? 0.6 : 1;
  }
  private powerOf(p: P): number {
    return p.fx === 'giant' ? 1.5 : p.fx === 'shrink' ? 0.5 : p.fx === 'dismounted' ? 0.4 : p.fx === 'speed' ? 1.25 : 1;
  }

  // ---- simulation ---------------------------------------------------------
  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;
    const cfg = this.cfg;

    // the ice shrinks over the second half so every round ends
    const shrink = smoothstep((this.t - cfg.timeLimit * 0.5) / (cfg.timeLimit * 0.5));
    this.globalR = START_RADIUS - (START_RADIUS - MIN_RADIUS) * shrink;

    if (cfg.walrus) this.stepWalrus(dt);
    if (cfg.tilt) this.stepTilt();
    if (cfg.beam) this.stepBolts(dt);

    this.stepSpawns(dt);
    this.stepBeam(dt);

    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.fallT > 0) this.stepWater(p, dt);
      else this.stepBear(p, dt);
    }
    this.resolveCollisions();
    if (cfg.wall) this.stepWall();
    this.stepItems();
    this.stepCarry(dt);
    this.stepFlying(dt);

    for (const p of this.players) {
      if (!p.alive || p.fallT > 0) continue;
      const edge = Math.min(this.globalR, polarEdge(this.ice, Math.atan2(p.y - CENTER, p.x - CENTER)));
      const dx = p.x - CENTER;
      const dy = p.y - CENTER;
      const dist = Math.hypot(dx, dy);
      if (dist > edge + this.radiusOf(p) * 0.35) {
        p.dashT = 0;
        p.holdingBomb = false;
        p.carry = ''; // lost in the water
        this.events.push({ kind: 'splash', id: p.id, x: r1(p.x), y: r1(p.y) });
        if ((p.vx * dx + p.vy * dy) / (dist || 1) > LEDGE_SPEED) {
          this.eliminate(p); // shoved out hard: no way back
          continue;
        }
        // a slide over the rim: it hangs on the edge and may climb back
        const k = (edge + this.radiusOf(p) * 0.2) / (dist || 1);
        p.x = CENTER + dx * k;
        p.y = CENTER + dy * k;
        p.vx = 0;
        p.vy = 0;
        p.fallT = CLIMB_TIME;
        p.climb = 0;
      }
    }

    const alive = this.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
    if (this.standing.isOver(alive) || this.t >= cfg.timeLimit) this.finished = true;
  }

  /** the slice in front of a bear at angle `a` (sector i is centred on i * 2pi / SECTORS) */
  private sliceAt(a: number): number {
    return Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / WALL_SLICES)) % WALL_SLICES;
  }

  private stepWall(): void {
    if (!this.wall) return;
    for (const p of this.players) {
      if (!p.alive || p.fallT > 0) continue;
      const dx = p.x - CENTER;
      const dy = p.y - CENTER;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;
      const a = Math.atan2(dy, dx);
      const i = this.sliceAt(a);
      if (!(this.wall & (1 << i))) continue;
      const limit = Math.min(this.globalR, polarEdge(this.ice, a)) - WALL_INNER - this.radiusOf(p); // the body stops at the slice's face
      if (dist <= limit) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const vOut = p.vx * nx + p.vy * ny;
      if (vOut > WALL_BREAK_SPEED) {
        this.wall &= ~(1 << i);
        p.vx *= WALL_KEEP;
        p.vy *= WALL_KEEP;
        this.events.push({ kind: 'crack', id: p.id, x: r1(p.x), y: r1(p.y) });
        continue;
      }
      p.x = CENTER + nx * limit;
      p.y = CENTER + ny * limit;
      if (vOut > 0) {
        p.vx -= (1 + WALL_BOUNCE) * vOut * nx;
        p.vy -= (1 + WALL_BOUNCE) * vOut * ny;
        if (vOut > 120) this.events.push({ kind: 'bump', id: p.id, x: r1(p.x), y: r1(p.y) });
      }
      p.dashT = 0;
    }
  }

  /** the bite: the sector and half as much of its two neighbours melt back for good */
  private melt(sector: number): void {
    for (const [o, w] of [[0, 1], [-1, 0.5], [1, 0.5]] as const) {
      const k = (sector + o + SECTORS) % SECTORS;
      this.ice[k] = Math.max(MIN_RADIUS, this.ice[k] - this.cfg.meltDepth * w);
    }
    const a = (sector / SECTORS) * Math.PI * 2;
    const r = Math.min(this.globalR, this.ice[sector]);
    this.events.push({ kind: 'ext:melt', id: '', x: r1(CENTER + Math.cos(a) * r), y: r1(CENTER + Math.sin(a) * r) });
  }

  /** the walrus' weight on the floe, 0..1 */
  private walrusWeight(): number {
    const w = this.walrus;
    if (!w) return 0;
    if (w.ph === 'in') return Math.min(1, w.t / WALRUS_IN);
    if (w.ph === 'eat') return 1;
    if (w.ph === 'out') return Math.max(0, 1 - w.t / WALRUS_OUT);
    return 0;
  }

  private walrusEdge(a: number): number {
    return Math.min(this.globalR, polarEdge(this.ice, a));
  }

  private stepWalrus(dt: number): void {
    const w = this.walrus;
    if (!w) {
      this.walrusTimer -= dt;
      if (this.walrusTimer > 0 || this.globalR < WALRUS_MIN_FLOE) return;
      this.walrus = { ph: 'fish', t: 0, a: this.rng() * Math.PI * 2 };
      return;
    }
    w.t += dt;
    const dur = w.ph === 'fish' ? FISH_TIME : w.ph === 'in' ? WALRUS_IN : w.ph === 'eat' ? WALRUS_EAT : WALRUS_OUT;
    if (w.t < dur) return;
    w.t = 0;
    if (w.ph === 'fish') {
      w.ph = 'in';
      this.events.push({ kind: 'ext:walrus', id: '', x: r1(CENTER + Math.cos(w.a) * this.walrusEdge(w.a)), y: r1(CENTER + Math.sin(w.a) * this.walrusEdge(w.a)) });
    } else if (w.ph === 'in') w.ph = 'eat';
    else if (w.ph === 'eat') w.ph = 'out';
    else {
      this.walrus = null;
      this.walrusTimer = nextIn(this.rng, this.cfg.walrusEvery, this.cfg.walrusVariance, WALRUS_MIN_GAP);
    }
  }

  private stepTilt(): void {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const p of this.players) {
      if (!p.alive || p.fallT > 0) continue;
      sx += p.x - CENTER;
      sy += p.y - CENTER;
      n++;
    }
    // centre of mass offset, relative to the floe size; saturates at 1
    let tx = n === 0 ? 0 : sx / n / (START_RADIUS * 0.5);
    let ty = n === 0 ? 0 : sy / n / (START_RADIUS * 0.5);
    if (this.walrus) {
      const ww = WALRUS_TILT * this.walrusWeight();
      tx += Math.cos(this.walrus.a) * ww;
      ty += Math.sin(this.walrus.a) * ww;
    }
    const m = Math.hypot(tx, ty);
    if (m > 1) {
      tx /= m;
      ty /= m;
    }
    this.tilt = { x: tx, y: ty };
  }

  private stepBolts(dt: number): void {
    this.boltTimer -= dt;
    if (this.boltTimer <= 0 && this.bolts.length < this.cfg.maxBolts) {
      this.boltTimer = nextIn(this.rng, this.cfg.boltEvery, this.cfg.boltVariance, 0.5);
      this.bolts.push({ a: this.rng() * Math.PI, d: (this.rng() * 2 - 1) * this.globalR * 0.7, t: 0 });
    }
    for (const b of this.bolts) {
      const was = b.t;
      b.t += dt;
      if (was < BOLT_WARN && b.t >= BOLT_WARN) {
        this.events.push({ kind: 'bolt', id: '', x: CENTER, y: CENTER });
      }
      if (b.t >= BOLT_WARN && b.t < BOLT_WARN + BOLT_ON) this.hitByBolt(b);
    }
    this.bolts = this.bolts.filter((b) => b.t < BOLT_WARN + BOLT_ON);
  }

  private hitByBolt(b: Bolt): void {
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    for (const p of this.players) {
      if (!p.alive || p.fallT > 0 || p.invulnT > 0 || p.stun > BOLT_STUN * 0.5) continue;
      // signed distance of the player from the bolt line
      const side = -(p.x - CENTER) * sin + (p.y - CENTER) * cos - b.d;
      if (Math.abs(side) > BOLT_HALF + this.radiusOf(p)) continue;
      const s = side >= 0 ? 1 : -1;
      p.vx = -sin * s * BOLT_KNOCK;
      p.vy = cos * s * BOLT_KNOCK;
      p.dashT = 0;
      p.stun = BOLT_STUN;
      p.invulnT = this.cfg.invulnTime;
      this.events.push({ kind: 'hit', id: p.id, x: r1(p.x), y: r1(p.y) });
    }
  }

  private stepSpawns(dt: number): void {
    const cfg = this.cfg;
    if (cfg.bombs) {
      this.bombTimer -= dt;
      if (this.bombTimer <= 0) {
        this.bombTimer = nextIn(this.rng, cfg.bombEvery, cfg.bombVariance, 1);
        if (this.items.length < MAX_ITEMS) this.spawnBomb();
      }
    }
  }

  private spawnBomb(): void {
    const a = this.rng() * Math.PI * 2;
    const edge = Math.min(this.globalR, polarEdge(this.ice, a));
    const r = Math.sqrt(this.rng()) * Math.max(0, edge - 70);
    const it: Item = { id: this.nextId++, x: CENTER + Math.cos(a) * r, y: CENTER + Math.sin(a) * r, k: 'bomb' };
    this.items.push(it);
    this.events.push({ kind: 'spawn', id: '', x: r1(it.x), y: r1(it.y) });
  }

  /**
   * the dispenser: orbit, then one task at a time. Beam: fly over the floe, aim, light the beam (the first bear in it gets
   * a power-up). Melt (Gruff): fly to the rim, melt a bite out of it. Then fly back.
   */
  private stepBeam(dt: number): void {
    const b = this.beam;
    this.beamTimer -= dt;
    if (this.cfg.melt) this.meltTimer -= dt;
    const ease = (k: number) => k * k * (3 - 2 * k);
    const orbitX = () => CENTER + Math.cos(this.orbitA) * (this.globalR + ORBIT_GAP);
    const orbitY = () => CENTER + Math.sin(this.orbitA) * (this.globalR + ORBIT_GAP);
    if (b.ph === 'idle') {
      this.orbitA = (this.orbitA + ORBIT_SPEED * dt) % (Math.PI * 2);
      b.x = orbitX();
      b.y = orbitY();
      const wantMelt = this.cfg.melt && this.meltTimer <= 0;
      if (this.beamTimer > 0 && !wantMelt) return;
      if (wantMelt && (this.beamTimer > 0 || this.meltTimer <= this.beamTimer)) {
        // a melt: to the rim at a random sector; the next one is due meltEvery (+/- meltVariance) from now
        b.task = 'melt';
        b.mi = Math.floor(this.rng() * SECTORS);
        const a = (b.mi / SECTORS) * Math.PI * 2;
        const r = Math.min(this.globalR, polarEdge(this.ice, a)) - MELT_INSET;
        b.sx = CENTER + Math.cos(a) * r;
        b.sy = CENTER + Math.sin(a) * r;
        this.meltTimer = nextIn(this.rng, this.cfg.meltEvery, this.cfg.meltVariance, MELT_MIN_GAP);
        b.fromX = b.x;
        b.fromY = b.y;
        b.ph = 'fly';
        b.t = 0;
        return;
      }
      b.task = 'beam';
      const a = this.rng() * Math.PI * 2;
      const edge = Math.min(this.globalR, polarEdge(this.ice, a));
      const r = Math.sqrt(this.rng()) * Math.max(0, edge - BEAM_SPOT_INSET);
      b.sx = CENTER + Math.cos(a) * r;
      b.sy = CENTER + Math.sin(a) * r;
      b.fromX = b.x;
      b.fromY = b.y;
      b.ph = 'fly';
      b.t = 0;
      return;
    }
    b.t += dt;
    if (b.ph === 'fly') {
      const k = ease(Math.min(1, b.t / BEAM_FLY));
      b.x = b.fromX + (b.sx - b.fromX) * k;
      b.y = b.fromY + (b.sy - b.fromY) * k;
      if (b.t >= BEAM_FLY) {
        b.ph = b.task === 'melt' ? 'melt' : 'aim';
        b.t = 0;
      }
    } else if (b.ph === 'melt') {
      if (b.t >= MELT_WARN) {
        this.melt(b.mi);
        b.ph = 'back';
        b.t = 0;
        b.fromX = b.sx;
        b.fromY = b.sy;
      }
    } else if (b.ph === 'aim') {
      if (b.t >= BEAM_AIM) {
        b.ph = 'on';
        b.t = 0;
        this.events.push({ kind: 'ext:beam', id: '', x: r1(b.sx), y: r1(b.sy) });
      }
    } else if (b.ph === 'on') {
      const taker = this.players.find((p) => p.alive && p.fallT <= 0 && (p.x - b.sx) ** 2 + (p.y - b.sy) ** 2 < (BEAM_R + this.radiusOf(p) * 0.5) ** 2);
      if (taker) {
        this.giveItem(taker);
        this.events.push({ kind: 'pickup', id: taker.id, x: r1(b.sx), y: r1(b.sy) });
      }
      if (taker || b.t >= BEAM_TIME) {
        b.ph = 'back';
        b.t = 0;
        b.fromX = b.sx;
        b.fromY = b.sy;
      }
    } else {
      // back to the orbit
      const k = ease(Math.min(1, b.t / BEAM_BACK));
      b.x = b.fromX + (orbitX() - b.fromX) * k;
      b.y = b.fromY + (orbitY() - b.fromY) * k;
      if (b.t >= BEAM_BACK) {
        b.ph = 'idle';
        b.t = 0;
        this.beamTimer = nextIn(this.rng, this.cfg.itemEvery, this.cfg.itemVariance, 1);
      }
    }
  }

  /** a random power-up for the bear that walked into the beam; unknown to everyone until then */
  private giveItem(p: P): void {
    // one Lightning/Weight at a time, and not for a bear whose hands are full
    const carried = this.players.some((q) => q.carry);
    const pool = this.cfg.beamItems
      ? carried ? BEAM : [...BEAM, ...CARRIED]
      : this.cfg.badItemsOnly
        ? carried ? BAD : [...BAD, 'weight' as const]
        : carried ? [...GOOD, ...BAD] : [...GOOD, ...BAD, ...CARRIED];
    const fx = pool[Math.floor(this.rng() * pool.length)];
    if (fx === 'lightning' || fx === 'weight') {
      p.carry = fx;
      p.carryT = CARRY_TIME;
      p.passT = PASS_COOLDOWN;
    } else {
      this.applyEffect(p, fx);
    }
  }

  private stepWater(p: P, dt: number): void {
    p.fallT -= dt;
    p.vx *= Math.exp(-FRICTION * dt);
    p.vy *= Math.exp(-FRICTION * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const press = p.input.a1 && !p.prevA1;
    p.prevA1 = p.input.a1;
    if (press) p.climb += CLIMB_PER_PRESS;
    if (p.climb >= 1) {
      // scramble back onto the rim
      const dx = p.x - CENTER;
      const dy = p.y - CENTER;
      const d = Math.hypot(dx, dy) || 1;
      const a = Math.atan2(dy, dx);
      const edge = Math.min(this.globalR, polarEdge(this.ice, a));
      const r = Math.max(40, edge - 45);
      p.x = CENTER + (dx / d) * r;
      p.y = CENTER + (dy / d) * r;
      p.vx = (-dx / d) * 160;
      p.vy = (-dy / d) * 160;
      p.fallT = 0;
      p.climb = 0;
      p.stun = 0.3;
    } else if (p.fallT <= 0) {
      this.eliminate(p);
    }
  }

  private stepBear(p: P, dt: number): void {
    p.stamina = Math.min(1, p.stamina + this.cfg.staminaRegen * dt);
    p.stun = Math.max(0, p.stun - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    if (p.fx) {
      p.fxT -= dt;
      if (p.fxT <= 0) p.fx = '';
    }
    const press = p.input.a1 && !p.prevA1;
    p.prevA1 = p.input.a1;

    let { mx, my } = p.input;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    if (len > 0.1) p.facing = Math.atan2(my, mx);

    const frozen = p.fx === 'freeze';
    const accel = ACCEL * (p.fx === 'speed' ? 1.3 : 1);
    const maxSpeed = MAX_SPEED * (p.fx === 'speed' ? 1.35 : 1);

    if (this.cfg.tilt) {
      p.vx += this.tilt.x * this.cfg.tiltStrength * dt;
      p.vy += this.tilt.y * this.cfg.tiltStrength * dt;
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
    } else if (!frozen && p.stun <= 0) {
      p.vx += mx * accel * dt;
      p.vy += my * accel * dt;
      const damp = Math.exp(-FRICTION * dt);
      p.vx *= damp;
      p.vy *= damp;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > maxSpeed) {
        p.vx = (p.vx / sp) * maxSpeed;
        p.vy = (p.vy / sp) * maxSpeed;
      }
      if (press) {
        if (p.holdingBomb) this.throwBomb(p);
        else if (p.stamina >= DASH_COST) {
          p.stamina -= DASH_COST;
          p.vx = Math.cos(p.facing) * DASH_SPEED;
          p.vy = Math.sin(p.facing) * DASH_SPEED;
          p.dashT = DASH_TIME;
          this.events.push({ kind: 'dash', id: p.id, x: r1(p.x), y: r1(p.y) });
        }
      }
    } else {
      const damp = Math.exp(-FRICTION * dt);
      p.vx *= damp;
      p.vy *= damp;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  private resolveCollisions(): void {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (!a.alive || a.fallT > 0) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (!b.alive || b.fallT > 0) continue;
        const minDist = this.radiusOf(a) + this.radiusOf(b);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const nx = dx / d;
        const ny = dy / d;
        const ma = this.massOf(a);
        const mb = this.massOf(b);
        this.passCarry(a, b);
        this.passCarry(b, a);
        const overlap = minDist - d;
        a.x -= (nx * overlap * mb) / (ma + mb);
        a.y -= (ny * overlap * mb) / (ma + mb);
        b.x += (nx * overlap * ma) / (ma + mb);
        b.y += (ny * overlap * ma) / (ma + mb);

        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn >= 0) continue;
        const j2 = (-(1 + BOUNCE) * vn) / (1 / ma + 1 / mb);
        a.vx -= (j2 * nx) / ma;
        a.vy -= (j2 * ny) / ma;
        b.vx += (j2 * nx) / mb;
        b.vy += (j2 * ny) / mb;
        if (a.dashT > 0) this.chargeHit(a, b, nx, ny);
        if (b.dashT > 0) this.chargeHit(b, a, -nx, -ny);
        if (-vn > 120) {
          this.events.push({ kind: 'bump', id: a.id, x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2) });
        }
      }
    }
  }

  /** `from` charged into `to`; (nx,ny) points from `from` to `to`. */
  private chargeHit(from: P, to: P, nx: number, ny: number): void {
    const share = (2 * this.massOf(from)) / (this.massOf(from) + this.massOf(to));
    to.vx += nx * DASH_PUSH * this.powerOf(from) * share;
    to.vy += ny * DASH_PUSH * this.powerOf(from) * share;
    to.stun = Math.max(to.stun, 0.2);
    to.dashT = 0;
  }

  private stepItems(): void {
    for (const p of this.players) {
      if (!p.alive || p.fallT > 0) continue;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        const reach = this.radiusOf(p) + ITEM_R;
        if ((p.x - it.x) ** 2 + (p.y - it.y) ** 2 > reach * reach) continue;
        if (p.holdingBomb) continue;
        p.holdingBomb = true;
        this.items.splice(i, 1);
        this.events.push({ kind: 'pickup', id: p.id, x: r1(it.x), y: r1(it.y) });
      }
    }
  }

  /** `from` holds Lightning/Weight and touches `to`: it goes over, the countdown keeps running */
  private passCarry(from: P, to: P): void {
    if (!from.carry || to.carry || from.passT > 0 || to.invulnT > 0 || to.fx === 'dismounted') return;
    to.carry = from.carry;
    to.carryT = from.carryT;
    to.passT = PASS_COOLDOWN;
    from.carry = '';
    this.events.push({ kind: 'catch', id: to.id, x: r1((from.x + to.x) / 2), y: r1((from.y + to.y) / 2) });
  }

  private stepCarry(dt: number): void {
    for (const p of this.players) {
      if (!p.alive || !p.carry) continue;
      p.passT = Math.max(0, p.passT - dt);
      p.carryT -= dt;
      if (p.carryT > 0) continue;
      const item = p.carry;
      p.carry = '';
      if (item === 'weight') {
        this.events.push({ kind: 'ext:weight', id: p.id, x: r1(p.x), y: r1(p.y) });
        this.eliminate(p);
        continue;
      }
      // Lightning: everyone else on the ice is stunned
      for (const o of this.players) {
        if (o === p || !o.alive || o.fallT > 0) continue;
        o.stun = LIGHTNING_STUN;
        o.dashT = 0;
      }
      this.events.push({ kind: 'zap', id: p.id, x: r1(p.x), y: r1(p.y) });
    }
  }

  private applyEffect(p: P, fx: Effect): void {
    p.fx = fx;
    p.fxT = fx === 'freeze' ? FREEZE_TIME : EFFECT_TIME;
    if (fx === 'freeze') {
      p.vx = 0;
      p.vy = 0;
      p.dashT = 0;
    }
  }

  private throwBomb(p: P): void {
    p.holdingBomb = false;
    this.flying.push({
      id: this.nextId++,
      x: p.x + Math.cos(p.facing) * (this.radiusOf(p) + 8),
      y: p.y + Math.sin(p.facing) * (this.radiusOf(p) + 8),
      vx: Math.cos(p.facing) * BOMB_SPEED,
      vy: Math.sin(p.facing) * BOMB_SPEED,
      life: BOMB_LIFE,
      owner: p.id,
    });
    this.events.push({ kind: 'dash', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  private stepFlying(dt: number): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const b = this.flying[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const direct = this.players.some(
        (p) => p.alive && p.fallT <= 0 && p.id !== b.owner && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (this.radiusOf(p) + 10) ** 2,
      );
      if (direct || b.life <= 0) {
        this.flying.splice(i, 1);
        this.explode(b);
      }
    }
  }

  private explode(b: Flying): void {
    this.events.push({ kind: 'boom', id: b.owner, x: r1(b.x), y: r1(b.y) });
    for (const p of this.players) {
      if (!p.alive || p.fallT > 0 || p.invulnT > 0 || p.id === b.owner) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > BOMB_BLAST + this.radiusOf(p)) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      p.vx = nx * BOMB_KNOCK;
      p.vy = ny * BOMB_KNOCK;
      p.dashT = 0;
      p.holdingBomb = false;
      p.hits++;
      // protection covers the dismounted stun plus the configured window (0 = off)
      p.invulnT = this.cfg.invulnTime > 0 ? 1.2 + this.cfg.invulnTime : 0;
      if (p.hits >= 2) {
        this.eliminate(p);
      } else {
        // knocked off the bear: slow, weak and stunned for a bit
        p.fx = 'dismounted';
        p.fxT = DISMOUNT_TIME;
        p.stun = 1.2;
      }
    }
  }

  private eliminate(p: P): void {
    p.alive = false;
    p.carry = '';
    p.fallT = 0;
    p.elimOrder = this.t; // simultaneous eliminations share a key and tie
    this.events.push({ kind: 'eliminated', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  // ---- Minigame output ----------------------------------------------------
  getState(): FrostShoveState {
    const players: PolarPlayerState[] = this.players.map((p) => ({
      id: p.id,
      x: r1(p.x),
      y: r1(p.y),
      f: r2(p.facing),
      alive: p.alive,
      inv: p.invulnT > 0,
      st: r2(p.stamina),
      r: r1(this.radiusOf(p)),
      fx: p.fx,
      fxl: p.fx ? r2(Math.min(1, p.fxT / (p.fx === 'freeze' ? FREEZE_TIME : p.fx === 'dismounted' ? DISMOUNT_TIME : EFFECT_TIME))) : 0,
      carry: p.carry,
      stun: r1(p.stun),
      carryl: p.carry ? r2(Math.max(0, p.carryT / CARRY_TIME)) : 0,
      drown: p.fallT > 0 ? r2(Math.max(0, p.fallT / CLIMB_TIME)) : 0,
      fall: p.fallT > 0 ? r2(Math.max(0.05, p.climb)) : 0,
      bomb: p.holdingBomb,
      hits: p.hits,
    }));
    const state: FrostShoveState = {
      kind: 'ext:frost-shove',
      variant: this.cfg.variant,
      t: r1(this.t),
      limit: this.cfg.timeLimit,
      sectors: this.ice.map((r) => r1(Math.min(r, this.globalR))),
      tilt: { x: r2(this.tilt.x), y: r2(this.tilt.y) },
      players,
      items: this.items.map((i) => ({ id: i.id, x: r1(i.x), y: r1(i.y), k: i.k })),
    };
    if (this.cfg.walrus && this.walrus) {
      const w = this.walrus;
      const inset = w.ph === 'fish' ? FISH_INSET : WALRUS_INSET;
      const total = w.ph === 'fish' ? FISH_TIME : w.ph === 'in' ? WALRUS_IN : w.ph === 'eat' ? WALRUS_EAT : WALRUS_OUT;
      state.walrus = { ph: w.ph, a: r2(w.a), r: r1(Math.max(MIN_RADIUS * 0.5, this.walrusEdge(w.a) - inset)), k: r2(Math.min(1, w.t / total)) };
    }
    if (this.cfg.beam) {
      state.bolts = this.bolts.map((b) => ({
        a: r2(b.a),
        d: r1(b.d),
        warn: r2(Math.max(0, 1 - b.t / BOLT_WARN)),
        on: b.t >= BOLT_WARN,
      }));
    }
    if (this.cfg.wall) state.wall = this.wall;
    if (this.cfg.bombs) state.flying = this.flying.map((f) => ({ id: f.id, x: r1(f.x), y: r1(f.y) }));
    if (this.cfg.melt) state.melts = this.beam.task === 'melt' && this.beam.ph !== 'idle' && this.beam.ph !== 'back' ? [{ i: this.beam.mi, k: this.beam.ph === 'melt' ? r2(Math.min(1, this.beam.t / MELT_WARN)) : 0 }] : [];
    const b = this.beam;
    const dur = b.ph === 'fly' ? BEAM_FLY : b.ph === 'aim' ? BEAM_AIM : b.ph === 'on' ? BEAM_TIME : b.ph === 'melt' ? MELT_WARN : b.ph === 'back' ? BEAM_BACK : 1;
    state.beam = {
      who: this.cfg.melt ? 'warden' : 'robot',
      ph: b.ph,
      x: r1(b.x),
      y: r1(b.y),
      sx: r1(b.sx),
      sy: r1(b.sy),
      r: BEAM_R,
      k: b.ph === 'idle' ? 0 : r2(Math.min(1, b.t / dur)),
    };
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
    const survivors = this.players.filter((p) => p.alive);
    // players still in the water (not yet climbed back) rank below those on the ice
    const onIce = survivors.filter((p) => p.fallT <= 0);
    const swimming = survivors.filter((p) => p.fallT > 0);
    const out: RawPlacement[] = [
      ...onIce.map((p) => ({ id: p.id, place: 1 })),
      ...swimming.map((p) => ({ id: p.id, place: onIce.length + 1 })),
    ];
    const dead = this.players.filter((p) => !p.alive);
    out.push(...this.standing.rankEliminated(dead, survivors.length + 1));
    return out;
  }
}
