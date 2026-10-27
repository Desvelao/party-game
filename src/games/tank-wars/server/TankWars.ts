import type { GameEvent, InputState } from '../../../core/shared/types';
import { NO_INPUT } from '../../../core/shared/types';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../core/shared/plugin-api';
import { circleBar } from '../../../core/shared/kit/collision';
import {
  TANK_BLOCKS,
  TANK_CENTRE,
  TANK_FULL_SIZE,
  arenaBorder,
  arenaBounds,
  TANK_MAX,
  TANK_METAL_WALLS,
  TANK_MIN,
  TANK_RAILS,
  TANK_RAIL_BLOCKS,
  TANK_RAIL_METAL_WALLS,
  RAIL_MIN,
  RAIL_MAX,
  TANK_RAIL_TURN,
  TANK_R,
  TANK_SPAWNS,
  nearestRail,
  TANK_TOTEM_HALF,
  TANK_TOTEM_POST,
  TANK_TOTEM_LEN,
  type TankRect,
} from '../shared/geometry';
import type { TankPlayerState, TankState } from '../shared/types';
import { LastStandingTracker, clamp, nextIn, r1, r2 } from './util';
import { TANK_DEFAULTS, type TankConfig } from './config';

const TAU = Math.PI * 2;
// exported constants: the bot (bot/physics.ts) predicts with them, so they cannot drift apart
export const TANK_SPEED = 150;
export const BOAT_SPEED = 170;
export const SHOT_R = 6;
export const MUZZLE = TANK_R + 8;
export const FIRE_CD = 0.25; // s between shots

/** cannon by seat: balanced, plasma (fast, weak), spiky (slow, strong), fireball (weak, two at once) */
export const CANNONS = [
  { speed: 520, dmg: 20, max: 1 },
  { speed: 760, dmg: 14, max: 1 },
  { speed: 340, dmg: 32, max: 1 },
  { speed: 480, dmg: 11, max: 2 },
];

export const MINE_FUSE = 3; // s
const MINE_ARM = 0.8; // s (Swamp Fox: before a tank can set it off)
export const MINE_TRIGGER_R = 30;
const MINE_R = 13; // the wandering mine's body, for bouncing off walls
const MINE_DMG = 45;
export const FIRE_LEN = 380;
export const FIRE_HALF = 22;
export const FIRE_STEP = 8;
export const JUNGLE_BLAST = 120;
export const SWAMP_BLAST = 90;
const MAX_MINES = 6;

export const BOMB_RANGE = 260;
export const BOMB_TIME = 0.6; // s in the air
export const BOMB_R = 90;
const BOMB_DMG = 40;

export const ROCKET_SPEED = 900;
export const ROCKET_DMG = 35;
const ROCKET_LIFE = 3;

const FRUIT_HEAL = 25;
export const PICKUP_R = 30;
const PICKUP_LAND = 0.8; // s a falling pick-up takes to land
const MAX_FRUIT = 3;

export const TOTEM_WARN = 1.2; // s
const TOTEM_SHOW = 0.6; // s
const TOTEM_DMG = 50;
export const WALL_WARN = 1.0; // s
const WALL_MIN_GAP = 2; // s, shortest time between two wall switches

export const SHIELD_HOLD = 0.35; // s of a2 held before it turns from "mine" into "shield"
const SHIELD_REGEN = 0.25; // per second
const BLAST_SHOW = 0.45; // s

interface P {
  id: string;
  seat: number;
  x: number;
  y: number;
  f: number;
  hp: number;
  alive: boolean;
  cannon: number;
  mines: number;
  item: '' | 'bomb' | 'missile';
  fireCd: number;
  invulnT: number;
  /** rail movement: the direction the tank is gliding in (-1/0/1 per axis) */
  dirX: number;
  dirY: number;
  shield: number;
  up: boolean;
  a2Held: number;
  prevA1: boolean;
  prevA2: boolean;
  elimOrder: number;
  input: InputState;
}

interface Shot {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  f: number;
  life: number;
  dmg: number;
  k: 'shot' | 'rocket';
  c: number;
}
interface Mine {
  id: number;
  owner: string;
  x: number;
  y: number;
  /** fuse mines: seconds left; trigger mines: unused */
  fuse: number;
  /** trigger mines: seconds until armed */
  arm: number;
  /** Swamp Fox: the mine drifts at this velocity (px/s), 0 for the others */
  vx: number;
  vy: number;
}
interface Bomb {
  id: number;
  owner: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}
interface Pickup {
  id: number;
  x: number;
  y: number;
  k: 'fruit' | 'mine' | 'bomb' | 'missile';
  land: number;
}
interface Blast {
  id: number;
  x: number;
  y: number;
  r: number;
  rays?: number[];
  life: number;
}

export class TankWars implements Minigame {
  readonly id: string;
  readonly name = 'Tank Wars';

  private players: P[] = [];
  private byId = new Map<string, P>();
  private events: GameEvent[] = [];
  private t = 0;
  private finished = false;
  private standing = new LastStandingTracker(0);
  private nextId = 1;

  private shots: Shot[] = [];
  private mines: Mine[] = [];
  private bombs: Bomb[] = [];
  private pickups: Pickup[] = [];
  private blasts: Blast[] = [];

  private fruitTimer = 0;
  private mineTimer = 0;
  /** Metal Fox: which group of walls is up (0 or 1) and seconds until they switch */
  private wallPhase = 0;
  private wallLeft = 0;
  private bombTimer = 0;
  private missileTimer = 0;
  private totemTimer = 0;
  private totemWarn = 0;
  private totemA = 0;
  private totemHit = 0;
  /** edges of the playable field and the bars that close in a smaller one */
  private readonly bounds: { min: number; max: number };
  private readonly border: TankRect[];

  constructor(
    private readonly cfg: TankConfig = TANK_DEFAULTS,
    private readonly rng: () => number = Math.random,
  ) {
    this.id = cfg.variant;
    this.bounds = arenaBounds(cfg.arenaSize);
    this.border = arenaBorder(cfg.arenaSize);
  }

  init(players: MinigamePlayer[]): void {
    const cfg = this.cfg;
    this.players = [];
    this.byId.clear();
    this.events = [];
    this.t = 0;
    this.finished = false;
    this.nextId = 1;
    this.shots = [];
    this.mines = [];
    this.bombs = [];
    this.pickups = [];
    this.blasts = [];
    this.fruitTimer = nextIn(this.rng, this.cfg.fruitEvery, this.cfg.fruitVariance);
    this.mineTimer = nextIn(this.rng, this.cfg.mineEvery, this.cfg.mineVariance);
    this.wallPhase = 0;
    this.wallLeft = nextIn(this.rng, this.cfg.wallEvery, this.cfg.wallVariance, WALL_MIN_GAP);
    this.bombTimer = nextIn(this.rng, this.cfg.bombEvery, this.cfg.bombVariance);
    this.missileTimer = nextIn(this.rng, this.cfg.missileEvery, this.cfg.missileVariance);
    this.totemTimer = nextIn(this.rng, this.cfg.totemEvery, this.cfg.totemVariance);
    this.totemWarn = 0;
    this.totemHit = 0;
    this.standing = new LastStandingTracker(players.length);

    players.forEach((pl, i) => {
      const sp = this.spawnAt(i);
      const p: P = {
        id: pl.id,
        seat: i,
        x: sp.x,
        y: sp.y,
        f: sp.f,
        hp: cfg.maxHp,
        alive: true,
        cannon: cfg.cannonTypes ? i % CANNONS.length : 0,
        mines: cfg.mines,
        item: '',
        fireCd: 0,
        invulnT: 0,
        dirX: 0,
        dirY: 0,
        shield: 1,
        up: false,
        a2Held: 0,
        prevA1: false,
        prevA2: false,
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
    if (p && p.alive) this.kill(p);
  }

  // ---- walls ------------------------------------------------------------

  private stepWalls(dt: number): void {
    this.wallLeft -= dt;
    if (this.wallLeft > 0) return;
    this.wallPhase ^= 1;
    this.wallLeft += nextIn(this.rng, this.cfg.wallEvery, this.cfg.wallVariance, WALL_MIN_GAP);
  }

  private wallsRaised(): boolean[] {
    const ph = this.wallPhase;
    return this.metalWalls().map((w) => w.group === ph);
  }

  private blocks(): TankRect[] {
    return this.cfg.rails ? TANK_RAIL_BLOCKS : TANK_BLOCKS;
  }

  private metalWalls(): typeof TANK_METAL_WALLS {
    return this.cfg.rails ? TANK_RAIL_METAL_WALLS : TANK_METAL_WALLS;
  }

  private solids(): TankRect[] {
    const out: TankRect[] = [];
    out.push(...this.border);
    if (this.cfg.maze) out.push(...this.blocks());
    if (this.cfg.totem) out.push(TANK_TOTEM_POST);
    if (this.cfg.metalWalls) {
      const up = this.wallsRaised();
      this.metalWalls().forEach((w, i) => {
        if (up[i]) out.push(w);
      });
    }
    return out;
  }

  private inSolid(x: number, y: number, pad: number, rects: TankRect[]): boolean {
    for (const r of rects) if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
    return false;
  }

  /** Push a circle out of a rectangle. */
  private pushOut(p: { x: number; y: number }, r: number, rect: TankRect): void {
    const nx = clamp(p.x, rect.x, rect.x + rect.w);
    const ny = clamp(p.y, rect.y, rect.y + rect.h);
    const dx = p.x - nx;
    const dy = p.y - ny;
    const d = Math.hypot(dx, dy);
    if (d >= r) return;
    if (d > 1e-6) {
      p.x += (dx / d) * (r - d);
      p.y += (dy / d) * (r - d);
      return;
    }
    // centre inside the rectangle: leave by the nearest side
    const l = p.x - rect.x;
    const rt = rect.x + rect.w - p.x;
    const tp = p.y - rect.y;
    const bt = rect.y + rect.h - p.y;
    const m = Math.min(l, rt, tp, bt);
    if (m === l) p.x = rect.x - r;
    else if (m === rt) p.x = rect.x + rect.w + r;
    else if (m === tp) p.y = rect.y - r;
    else p.y = rect.y + rect.h + r;
  }

  // ---- the loop ---------------------------------------------------------

  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;

    if (this.cfg.metalWalls) this.stepWalls(dt);
    this.stepSpawns(dt);
    this.stepTotem(dt);
    const solids = this.solids();
    for (const p of this.players) if (p.alive) this.stepPlayer(p, dt, solids);
    this.separate();
    if (this.cfg.rails) for (const p of this.players) if (p.alive) this.snapToRail(p);
    this.stepPickups();
    this.stepShots(dt, solids);
    this.stepBombs(dt);
    this.stepMines(dt, solids);
    for (const b of this.blasts) b.life -= dt / BLAST_SHOW;
    this.blasts = this.blasts.filter((b) => b.life > 0);

    const alive = this.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
    if (this.standing.isOver(alive) || this.t >= this.cfg.timeLimit) this.finished = true;
  }

  /** Start slot `i`: the standard corner / edge spots, pulled in to a smaller field. */
  private spawnAt(i: number): { x: number; y: number; f: number } {
    const sp = TANK_SPAWNS[i % TANK_SPAWNS.length];
    if (this.cfg.arenaSize >= TANK_FULL_SIZE) return sp;
    const { min, max } = this.bounds;
    const k = (max - min - 100) / (TANK_MAX - TANK_MIN - 100);
    return { x: TANK_CENTRE + (sp.x - TANK_CENTRE) * k, y: TANK_CENTRE + (sp.y - TANK_CENTRE) * k, f: sp.f };
  }

  private freePoint(solids: TankRect[]): { x: number; y: number } {
    for (let i = 0; i < 30; i++) {
      const { min, max } = this.bounds;
      const x = min + 50 + this.rng() * (max - min - 100);
      const y = min + 50 + this.rng() * (max - min - 100);
      if (!this.inSolid(x, y, TANK_R + 6, solids)) return { x, y };
    }
    return { x: this.bounds.min + 80, y: this.bounds.min + 80 };
  }

  /** A point on a rail (so the pick-up can be reached when tanks stay on the rails). */
  private railPoint(): { x: number; y: number } {
    const line = TANK_RAILS[Math.floor(this.rng() * TANK_RAILS.length) % TANK_RAILS.length];
    const along = TANK_MIN + 40 + this.rng() * (TANK_MAX - TANK_MIN - 80);
    return this.rng() < 0.5 ? { x: line, y: along } : { x: along, y: line };
  }

  private addPickup(k: Pickup['k'], land = 0): void {
    const { x, y } = this.cfg.rails ? this.railPoint() : this.freePoint(this.cfg.maze ? this.blocks() : this.cfg.totem ? [TANK_TOTEM_POST] : []);
    this.pickups.push({ id: this.nextId++, x, y, k, land });
  }

  private stepSpawns(dt: number): void {
    const cfg = this.cfg;
    if (!cfg.swamp) {
      this.fruitTimer -= dt;
      if (this.fruitTimer <= 0) {
        this.fruitTimer = nextIn(this.rng, this.cfg.fruitEvery, this.cfg.fruitVariance);
        if (this.pickups.filter((k) => k.k === 'fruit').length < MAX_FRUIT) this.addPickup('fruit');
      }
      this.mineTimer -= dt;
      if (this.mineTimer <= 0) {
        this.mineTimer = nextIn(this.rng, this.cfg.mineEvery, this.cfg.mineVariance);
        if (!this.pickups.some((k) => k.k === 'mine')) this.addPickup('mine');
      }
    }
    if (cfg.bombs) {
      this.bombTimer -= dt;
      if (this.bombTimer <= 0) {
        this.bombTimer = nextIn(this.rng, this.cfg.bombEvery, this.cfg.bombVariance);
        if (!this.pickups.some((k) => k.k === 'bomb')) this.addPickup('bomb');
      }
    }
    if (cfg.missiles) {
      this.missileTimer -= dt;
      if (this.missileTimer <= 0) {
        this.missileTimer = nextIn(this.rng, this.cfg.missileEvery, this.cfg.missileVariance);
        if (!this.pickups.some((k) => k.k === 'missile')) this.addPickup('missile', PICKUP_LAND);
      }
    }
    for (const k of this.pickups) if (k.land > 0) k.land = Math.max(0, k.land - dt);
  }

  private stepTotem(dt: number): void {
    if (!this.cfg.totem) return;
    if (this.totemHit > 0) this.totemHit = Math.max(0, this.totemHit - dt);
    if (this.totemWarn > 0) {
      this.totemWarn -= dt;
      if (this.totemWarn <= 0) {
        this.totemWarn = 0;
        this.totemHit = TOTEM_SHOW;
        this.events.push({ kind: 'smash', id: '', x: TANK_CENTRE, y: TANK_CENTRE });
        for (const p of this.players) {
          if (!p.alive) continue;
          const c = circleBar(p.x, p.y, TANK_R, TANK_CENTRE, TANK_CENTRE, this.totemA, TANK_TOTEM_LEN, TANK_TOTEM_HALF);
          if (c.hit) this.hurt(p, TOTEM_DMG);
        }
      }
    } else {
      this.totemTimer -= dt;
      if (this.totemTimer <= 0) {
        this.totemTimer = nextIn(this.rng, this.cfg.totemEvery, this.cfg.totemVariance);
        this.totemWarn = TOTEM_WARN;
        this.totemA = this.rng() * TAU;
      }
    }
  }

  // ---- tanks --------------------------------------------------------------

  private stepPlayer(p: P, dt: number, solids: TankRect[]): void {
    const cfg = this.cfg;
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    const { mx, my, a1, a2 } = p.input;
    const len = Math.hypot(mx, my);

    // move: along the rails (turning at crossings), or freely
    let vx = 0;
    let vy = 0;
    if (cfg.rails) {
      [vx, vy] = this.railDirection(p, mx, my, len);
    } else if (len > 0.3) {
      vx = mx / Math.max(1, len);
      vy = my / Math.max(1, len);
    }
    if (vx !== 0 || vy !== 0) p.f = Math.atan2(vy, vx);
    const speed = cfg.swamp ? BOAT_SPEED : TANK_SPEED;
    p.x += vx * speed * dt;
    p.y += vy * speed * dt;
    for (const r of solids) this.pushOut(p, TANK_R, r);
    const lo = cfg.rails ? RAIL_MIN : this.bounds.min + TANK_R;
    const hi = cfg.rails ? RAIL_MAX : this.bounds.max - TANK_R;
    p.x = clamp(p.x, lo, hi);
    p.y = clamp(p.y, lo, hi);
    if (cfg.rails) this.snapToRail(p);

    // secondary action: plant a mine; in Swamp Fox holding it raises the shield instead
    if (cfg.swamp) {
      if (a2) {
        p.a2Held += dt;
        p.up = p.a2Held >= SHIELD_HOLD && p.shield > 0;
        if (p.up) {
          p.shield = Math.max(0, p.shield - dt / cfg.shieldTime);
          if (p.shield === 0) p.up = false;
        }
      } else {
        if (p.prevA2 && p.a2Held < SHIELD_HOLD) this.dropMine(p);
        p.a2Held = 0;
        p.up = false;
        p.shield = Math.min(1, p.shield + SHIELD_REGEN * dt);
      }
    } else if (a2 && !p.prevA2) {
      this.dropMine(p);
    }

    // primary action: use the held item on the press, otherwise the cannon while held
    let usedItem = false;
    if (a1 && !p.prevA1 && p.item) {
      if (p.item === 'bomb') this.lobBomb(p);
      else this.fireMissiles(p);
      p.item = '';
      usedItem = true;
    }
    if (a1 && !usedItem && !p.up) this.fireCannon(p);
    p.prevA1 = a1;
    p.prevA2 = a2;
  }

  /** Put a tank that is off the grid back on the nearest rail (the smaller deviation wins). */
  private snapToRail(p: P): void {
    const dx = Math.abs(p.x - nearestRail(p.x));
    const dy = Math.abs(p.y - nearestRail(p.y));
    if (dx < 0.5 || dy < 0.5) return;
    if (dy <= dx) p.y = nearestRail(p.y);
    else p.x = nearestRail(p.x);
  }

  /**
   * Rail movement: the requested axis is taken at once when the tank is already on a rail of that
   * axis, or at a crossing (snapping onto it). Otherwise it keeps gliding the way it was going, so
   * holding a direction turns at the next crossing. No input stops the tank.
   */
  private railDirection(p: P, mx: number, my: number, len: number): [number, number] {
    this.snapToRail(p);
    if (len <= 0.3) return [0, 0];
    const horiz = Math.abs(mx) >= Math.abs(my);
    const rx = horiz ? Math.sign(mx) : 0;
    const ry = horiz ? 0 : Math.sign(my);
    const onH = Math.abs(p.y - nearestRail(p.y)) < 0.5; // on a horizontal rail: can drive left/right
    const onV = Math.abs(p.x - nearestRail(p.x)) < 0.5; // on a vertical rail: can drive up/down
    if (horiz) {
      if (onH || Math.abs(p.y - nearestRail(p.y)) <= TANK_RAIL_TURN) {
        p.y = nearestRail(p.y);
        p.dirX = rx;
        p.dirY = 0;
      }
    } else if (onV || Math.abs(p.x - nearestRail(p.x)) <= TANK_RAIL_TURN) {
      p.x = nearestRail(p.x);
      p.dirX = 0;
      p.dirY = ry;
    }
    return [p.dirX, p.dirY];
  }

  private fireCannon(p: P): void {
    const c = CANNONS[p.cannon];
    if (p.fireCd > 0) return;
    const inFlight = this.shots.filter((s) => s.owner === p.id && s.k === 'shot').length;
    if (inFlight >= c.max) return;
    p.fireCd = FIRE_CD;
    const cos = Math.cos(p.f);
    const sin = Math.sin(p.f);
    this.shots.push({
      id: this.nextId++,
      owner: p.id,
      x: p.x + cos * MUZZLE,
      y: p.y + sin * MUZZLE,
      vx: cos * c.speed,
      vy: sin * c.speed,
      f: p.f,
      life: this.cfg.shotLife,
      dmg: c.dmg,
      k: 'shot',
      c: p.cannon,
    });
    this.events.push({ kind: 'throw', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  private fireMissiles(p: P): void {
    const cos = Math.cos(p.f);
    const sin = Math.sin(p.f);
    for (const side of [-1, 1]) {
      this.shots.push({
        id: this.nextId++,
        owner: p.id,
        x: p.x + cos * MUZZLE - sin * side * 12,
        y: p.y + sin * MUZZLE + cos * side * 12,
        vx: cos * ROCKET_SPEED,
        vy: sin * ROCKET_SPEED,
        f: p.f,
        life: ROCKET_LIFE,
        dmg: ROCKET_DMG,
        k: 'rocket',
        c: p.cannon,
      });
    }
    this.events.push({ kind: 'rocket', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  private lobBomb(p: P): void {
    const x1 = clamp(p.x + Math.cos(p.f) * BOMB_RANGE, this.bounds.min, this.bounds.max);
    const y1 = clamp(p.y + Math.sin(p.f) * BOMB_RANGE, this.bounds.min, this.bounds.max);
    this.bombs.push({ id: this.nextId++, owner: p.id, x0: p.x, y0: p.y, x1, y1, t: BOMB_TIME });
    this.events.push({ kind: 'throw', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  private dropMine(p: P): void {
    if (p.mines <= 0 || !p.alive) return;
    p.mines--;
    const drift = this.cfg.swamp ? this.rng() * Math.PI * 2 : 0;
    const speed = this.cfg.swamp ? this.cfg.mineSpeed : 0;
    this.mines.push({
      id: this.nextId++,
      owner: p.id,
      x: p.x,
      y: p.y,
      fuse: MINE_FUSE,
      arm: MINE_ARM,
      vx: Math.cos(drift) * speed,
      vy: Math.sin(drift) * speed,
    });
    this.events.push({ kind: 'spawn', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  private separate(): void {
    const ps = this.players.filter((p) => p.alive);
    const min = TANK_R * 2;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }

  private stepPickups(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const k of this.pickups) {
        if (k.land > 0 || Math.hypot(k.x - p.x, k.y - p.y) > PICKUP_R + TANK_R * 0.5) continue;
        if (k.k === 'fruit') {
          if (p.hp >= this.cfg.maxHp) continue; // nothing to heal: leave it
          p.hp = Math.min(this.cfg.maxHp, p.hp + FRUIT_HEAL);
          this.events.push({ kind: 'heal', id: p.id, x: r1(k.x), y: r1(k.y) });
        } else if (k.k === 'mine') {
          p.mines = Math.min(MAX_MINES, p.mines + 1);
          this.events.push({ kind: 'pickup', id: p.id, x: r1(k.x), y: r1(k.y) });
        } else {
          if (p.item) continue;
          p.item = k.k;
          this.events.push({ kind: 'pickup', id: p.id, x: r1(k.x), y: r1(k.y) });
        }
        k.id = -1;
      }
    }
    this.pickups = this.pickups.filter((k) => k.id !== -1);
  }

  private stepShots(dt: number, solids: TankRect[]): void {
    const out: Shot[] = [];
    for (const s of this.shots) {
      s.life -= dt;
      if (s.life <= 0) continue;
      if (this.cfg.shotBounce && s.k === 'shot') {
        this.moveBouncing(s, dt, SHOT_R, solids);
        s.f = Math.atan2(s.vy, s.vx);
      } else {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < TANK_MIN || s.x > TANK_MAX || s.y < TANK_MIN || s.y > TANK_MAX) continue;
        if (this.inSolid(s.x, s.y, SHOT_R, solids)) continue;
      }
      let hit = false;
      for (const p of this.players) {
        if (!p.alive || p.id === s.owner) continue;
        if (Math.hypot(p.x - s.x, p.y - s.y) > TANK_R + SHOT_R) continue;
        this.hurt(p, s.dmg);
        hit = true;
        break;
      }
      if (!hit) out.push(s);
    }
    this.shots = out;
  }

  /** the field edge or a solid stops something of radius `pad` at (x, y) */
  private blockedAt(x: number, y: number, pad: number, solids: TankRect[]): boolean {
    const { min, max } = this.bounds;
    return x < min + pad || x > max - pad || y < min + pad || y > max - pad || this.inSolid(x, y, pad, solids);
  }

  /** Move the object by its velocity; what blocks an axis turns that velocity around (both at a corner). */
  private moveBouncing(o: { x: number; y: number; vx: number; vy: number }, dt: number, pad: number, solids: TankRect[]): void {
    const nx = o.x + o.vx * dt;
    const ny = o.y + o.vy * dt;
    if (!this.blockedAt(nx, ny, pad, solids)) {
      o.x = nx;
      o.y = ny;
      return;
    }
    const bx = this.blockedAt(nx, o.y, pad, solids);
    const by = this.blockedAt(o.x, ny, pad, solids);
    if (bx || !by) o.vx = -o.vx; // blocked along x, or only the diagonal (a corner)
    if (by || !bx) o.vy = -o.vy;
    if (!bx) o.x = nx;
    if (!by) o.y = ny;
  }

  private stepBombs(dt: number): void {
    const out: Bomb[] = [];
    for (const b of this.bombs) {
      b.t -= dt;
      if (b.t > 0) {
        out.push(b);
        continue;
      }
      this.explodeRadial(b.x1, b.y1, BOMB_R, BOMB_DMG);
    }
    this.bombs = out;
  }

  private stepMines(dt: number, solids: TankRect[]): void {
    const out: Mine[] = [];
    for (const m of this.mines) {
      let boom = false;
      if (this.cfg.swamp) {
        this.moveBouncing(m, dt, MINE_R, solids);
        m.arm = Math.max(0, m.arm - dt);
        if (m.arm === 0) boom = this.players.some((p) => p.alive && Math.hypot(p.x - m.x, p.y - m.y) <= MINE_TRIGGER_R + TANK_R * 0.5);
      } else {
        m.fuse -= dt;
        boom = m.fuse <= 0;
      }
      if (!boom) {
        out.push(m);
        continue;
      }
      if (this.cfg.maze) this.explodeFire(m.x, m.y, solids);
      else this.explodeRadial(m.x, m.y, this.cfg.swamp ? SWAMP_BLAST : JUNGLE_BLAST, MINE_DMG);
    }
    this.mines = out;
  }

  private explodeRadial(x: number, y: number, r: number, dmg: number): void {
    this.blasts.push({ id: this.nextId++, x, y, r, life: 1 });
    this.events.push({ kind: 'explode', id: '', x: r1(x), y: r1(y) });
    for (const p of this.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - x, p.y - y) <= r + TANK_R * 0.5) this.hurt(p, dmg);
    }
  }

  /** Desert / Metal Fox: fire runs down the four corridors until it meets a wall. */
  private explodeFire(x: number, y: number, solids: TankRect[]): void {
    const dirs = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    const rays = dirs.map(([dx, dy]) => {
      let len = 0;
      while (len < FIRE_LEN) {
        const nx = x + dx * (len + FIRE_STEP);
        const ny = y + dy * (len + FIRE_STEP);
        if (nx < TANK_MIN || nx > TANK_MAX || ny < TANK_MIN || ny > TANK_MAX || this.inSolid(nx, ny, 0, solids)) break;
        len += FIRE_STEP;
      }
      return len;
    });
    this.blasts.push({ id: this.nextId++, x, y, r: FIRE_HALF + 8, rays, life: 1 });
    this.events.push({ kind: 'explode', id: '', x: r1(x), y: r1(y) });
    for (const p of this.players) {
      if (!p.alive) continue;
      const ox = p.x - x;
      const oy = p.y - y;
      let hit = Math.hypot(ox, oy) <= FIRE_HALF + TANK_R;
      dirs.forEach(([dx, dy], i) => {
        const along = ox * dx + oy * dy;
        const across = Math.abs(ox * dy - oy * dx);
        if (along >= -TANK_R && along <= rays[i] + TANK_R && across <= FIRE_HALF + TANK_R * 0.5) hit = true;
      });
      if (hit) this.hurt(p, MINE_DMG);
    }
  }

  private hurt(p: P, dmg: number): void {
    if (!p.alive) return;
    if (p.up) {
      this.events.push({ kind: 'zap', id: p.id, x: r1(p.x), y: r1(p.y) });
      return;
    }
    if (p.invulnT > 0) return;
    p.invulnT = this.cfg.invulnTime;
    p.hp = Math.max(0, p.hp - dmg);
    this.events.push({ kind: 'hit', id: p.id, x: r1(p.x), y: r1(p.y) });
    if (p.hp <= 0) this.kill(p);
  }

  private kill(p: P): void {
    p.alive = false;
    p.hp = 0;
    p.elimOrder = this.t;
    p.up = false;
    this.events.push({ kind: 'eliminated', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  // ---- output ---------------------------------------------------------------

  getState(): TankState {
    const cfg = this.cfg;
    const players: TankPlayerState[] = this.players.map((p) => ({
      id: p.id,
      x: r1(p.x),
      y: r1(p.y),
      f: r2(p.f),
      hp: r1(p.hp),
      alive: p.alive,
      cannon: p.cannon,
      mines: p.mines,
      shield: r2(p.shield),
      up: p.up,
      inv: p.invulnT > 0,
      item: p.item,
    }));
    const s: TankState = {
      kind: 'ext:tank-wars',
      variant: cfg.variant,
      t: r1(this.t),
      limit: cfg.timeLimit,
      maxHp: cfg.maxHp,
      rails: cfg.rails,
      size: cfg.arenaSize,
      players,
      shots: this.shots.map((q) => ({ id: q.id, x: r1(q.x), y: r1(q.y), f: r2(q.f), k: q.k, c: q.c })),
      bombs: this.bombs.map((b) => ({
        id: b.id,
        x: r1(b.x0 + (b.x1 - b.x0) * (1 - b.t / BOMB_TIME)),
        y: r1(b.y0 + (b.y1 - b.y0) * (1 - b.t / BOMB_TIME)),
        h: r2(1 - b.t / BOMB_TIME),
      })),
      mines: this.mines.map((m) => ({ id: m.id, x: r1(m.x), y: r1(m.y), fuse: cfg.swamp ? -1 : r2(Math.max(0, m.fuse) / MINE_FUSE) })),
      pickups: this.pickups.map((k) => ({ id: k.id, x: r1(k.x), y: r1(k.y), k: k.k, land: r2(k.land / PICKUP_LAND) })),
      blasts: this.blasts.map((b) => ({ id: b.id, x: r1(b.x), y: r1(b.y), r: b.r, ...(b.rays ? { rays: b.rays } : {}), life: r2(Math.max(0, b.life)) })),
    };
    if (cfg.metalWalls) {
      s.walls = { raised: this.wallsRaised(), warn: this.wallLeft < WALL_WARN };
    }
    if (cfg.totem) {
      s.totem = { a: r2(this.totemA), warn: this.totemWarn > 0 ? r2(this.totemWarn / TOTEM_WARN) : 0, hit: r2(this.totemHit / TOTEM_SHOW) };
    }
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
    // survivors by health (equal health shares a place), then the fallen, latest first
    const alive = this.players.filter((p) => p.alive).sort((a, b) => b.hp - a.hp);
    const out: RawPlacement[] = [];
    let place = 0;
    alive.forEach((p, i) => {
      if (i === 0 || p.hp !== alive[i - 1].hp) place = i + 1;
      out.push({ id: p.id, place });
    });
    out.push(...this.standing.rankEliminated(this.players.filter((p) => !p.alive), alive.length + 1));
    return out;
  }
}
