import { LastStandingTracker, clamp, nextIn, pick, r1, r2 } from '../../../core/shared/kit/util';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../core/shared/plugin-api';
import { NO_INPUT, type GameEvent, type GameEventKind, type InputState } from '../../../core/shared/types';
import { CRATE_ARENA } from '../shared/geometry';
import type { CrateKind, CratePickupKind, CratePlayerState, CrateState, CrateWeapon } from '../shared/types';
import { CRATE_DEFAULTS, type CrateConfig } from './config';

const X0 = CRATE_ARENA.x;
const Y0 = CRATE_ARENA.y;
const X1 = CRATE_ARENA.x + CRATE_ARENA.size;
const Y1 = CRATE_ARENA.y + CRATE_ARENA.size;
const CX = CRATE_ARENA.x + CRATE_ARENA.size / 2;
const CY = CRATE_ARENA.y + CRATE_ARENA.size / 2;
// exported constants: the bot (bot/physics.ts) predicts with them, so they cannot drift apart
export const GRID = 10;
export const TILE = CRATE_ARENA.size / GRID;

export const PLAYER_R = 24;
export const CRATE_R = 22;
export const SPEED = 260;
export const GRIP = 12; // 1/s: how fast velocity follows the stick
export const GRIP_ICE = 2.2;
export const CARRY_SLOW = 0.75;
export const HOLD_DIST = PLAYER_R + CRATE_R * 0.5; // carried crate sits this far in front of the player
export const BOOTS_SPEED = 1.5;
export const Z_SPEED = 0.4;
const BOOTS_TIME = 8;
const Z_TIME = 8;
const MASK_TIME = 10;

const KICK_KNOCK = 420;
export const KICK_SPEED = 520;
const KICK_DAMAGE = 1;
const SPIN_TIME = 0.3;
export const THROW_SPEED = 640;
export const CRATE_FRICTION = 1.4;
export const FLY_MIN = 90; // below this a sliding crate stops being dangerous
const PENGUIN_THROW = 700; // px/s a crate the penguin touches is flung outward at
const PLAYER_FLING = 1100; // px/s a player the penguin touches is thrown outward at
const FLING_TIME = 0.55; // s a thrown player glides without steering

export const DAMAGE: Record<CrateKind, number> = { block: 2, locked: 1, tnt: 4, nitro: 5 };
const MAX_CRATES = 9;
const MAX_BERRY = 3;
const MAX_POWERUPS = 2;
const BERRY_HEAL = 2;

const RING_DAMAGE = 8;
export const RING_RANGE = 130;
export const MISSILE_SPEED = 540;
const MISSILE_DAMAGE = 3;
export const ORB_SPEED = 300;
const ORB_DAMAGE = 2;
const SHOT_LIFE = 1.4;
const ORB_LIFE = 3.5;
const CHARGES: Record<CrateWeapon, number> = { ring: 1, missile: 2, orb: 3 };

export const PENGUIN_R = 40;
export const PENGUIN_SPIN = 2.4; // rad/s the penguin circles the field centre at
const PENGUIN_ORBIT = 280;
const PENGUIN_REST = 6;

interface P {
  id: string;
  idx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  alive: boolean;
  hold: C | null;
  mask: number;
  boots: number;
  slow: number;
  weightT: number;
  passCd: number;
  weapon: '' | CrateWeapon;
  charges: number;
  spinT: number;
  actCd: number;
  /** kick cooldown */
  kickCd: number;
  penguinCd: number;
  /** seconds left of being thrown (by the penguin): no steering, only sliding */
  flingT: number;
  invulnT: number;
  elimOrder: number;
  prevA1: boolean;
  prevA2: boolean;
  /** a button went down since the last tick (latched when the input arrives, so a quick tap is never lost) */
  pressA1: boolean;
  pressA2: boolean;
  input: InputState;
}

interface C {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: CrateKind;
  /** seconds to explosion, -1 = unlit */
  fuse: number;
  holder: number;
  owner: number;
  flying: boolean;
  /** flung by the penguin: bounces off the walls instead of breaking, until it comes to rest */
  bounce?: boolean;
  /** removed at the end of the step */
  dead: boolean;
}

interface Pick {
  id: number;
  x: number;
  y: number;
  k: CratePickupKind;
  set: number;
  weapon?: CrateWeapon;
}

interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: 'missile' | 'orb' | 'ring';
  owner: number;
  life: number;
}


export class BoxBonanza implements Minigame {
  readonly id: string;
  readonly name = 'Box Bonanza';

  private players: P[] = [];
  private byId = new Map<string, P>();
  private crates: C[] = [];
  private pickups: Pick[] = [];
  private shots: Shot[] = [];
  private holes: number[] = [];
  private events: GameEvent[] = [];
  private blasts: C[] = [];
  private t = 0;
  private nextId = 1;
  private nextSet = 1;
  private crateTimer = 0;
  private berryTimer = 0;
  private powerTimer = 0;
  private boxTimer = 0;
  private penguin = { awake: false, t: 0, a: 0, rest: 0 };
  private standing = new LastStandingTracker(0);
  private finished = false;

  constructor(
    private readonly cfg: CrateConfig = CRATE_DEFAULTS,
    private readonly rng: () => number = Math.random,
  ) {
    this.id = cfg.variant;
  }

  init(players: MinigamePlayer[]): void {
    this.players = [];
    this.byId.clear();
    this.crates = [];
    this.pickups = [];
    this.shots = [];
    this.blasts = [];
    this.events = [];
    this.holes = new Array<number>(GRID * GRID).fill(0);
    this.t = 0;
    this.nextId = 1;
    this.nextSet = 1;
    this.crateTimer = nextIn(this.rng, this.cfg.crateEvery, this.cfg.crateVariance, 1);
    this.berryTimer = 5;
    this.powerTimer = this.cfg.powerupEvery * 0.6;
    this.boxTimer = this.cfg.boxEvery * 0.5;
    this.penguin = { awake: false, t: 0, a: 0, rest: 0 };
    this.finished = false;
    this.standing = new LastStandingTracker(players.length);

    const n = players.length;
    players.forEach((pl, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const p: P = {
        id: pl.id,
        idx: i,
        x: CX + Math.cos(a) * 330,
        y: CY + Math.sin(a) * 330,
        vx: 0,
        vy: 0,
        facing: a + Math.PI,
        hp: this.cfg.maxHp,
        alive: true,
        hold: null,
        mask: 0,
        boots: 0,
        slow: 0,
        weightT: 0,
        passCd: 0,
        weapon: '',
        charges: 0,
        spinT: 0,
        actCd: 0,
        kickCd: 0,
        penguinCd: 0,
        flingT: 0,
        invulnT: 0,
        elimOrder: 0,
        prevA1: false,
        prevA2: false,
        pressA1: false,
        pressA2: false,
        input: NO_INPUT,
      };
      this.players.push(p);
      this.byId.set(p.id, p);
    });
    for (let i = 0; i < 6; i++) this.dropCrate();
    this.spawnPickup('berry');
    this.spawnPickup('berry');
  }

  handleInput(playerId: string, input: InputState): void {
    const p = this.byId.get(playerId);
    if (!p) return;
    // a tap whose down and up messages land between two ticks must still count
    if (input.a1 && !p.input.a1) p.pressA1 = true;
    if (input.a2 && !p.input.a2) p.pressA2 = true;
    p.input = input;
  }

  removePlayer(playerId: string): void {
    const p = this.byId.get(playerId);
    if (p && p.alive) this.eliminate(p);
  }

  // ---- helpers ------------------------------------------------------------
  private emit(kind: GameEventKind, x: number, y: number, id = ''): void {
    this.events.push({ kind, id, x: r1(x), y: r1(y) });
  }

  private holeAt(x: number, y: number): boolean {
    if (!this.cfg.floorHoles) return false;
    const c = Math.floor((x - X0) / TILE);
    const r = Math.floor((y - Y0) / TILE);
    if (c < 0 || r < 0 || c >= GRID || r >= GRID) return false;
    return this.holes[r * GRID + c] === 1;
  }

  private randomSpot(minFromPlayers = 100): { x: number; y: number } | null {
    for (let tries = 0; tries < 40; tries++) {
      const x = X0 + 60 + this.rng() * (CRATE_ARENA.size - 120);
      const y = Y0 + 60 + this.rng() * (CRATE_ARENA.size - 120);
      if (this.holeAt(x, y)) continue;
      if (this.cfg.penguin && Math.hypot(x - CX, y - CY) < PENGUIN_R + 70) continue;
      if (this.players.some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < minFromPlayers)) continue;
      if (this.crates.some((c) => Math.hypot(c.x - x, c.y - y) < 60)) continue;
      return { x, y };
    }
    return null;
  }

  private dropCrate(): void {
    const at = this.randomSpot();
    if (!at) return;
    const roll = this.rng();
    let k: CrateKind;
    if (this.cfg.lockedCrates) k = roll < 0.75 ? 'locked' : 'tnt';
    else if (this.cfg.nitro) k = roll < 0.58 ? 'block' : roll < 0.84 ? 'tnt' : 'nitro';
    else k = roll < 0.75 ? 'block' : 'tnt';
    this.crates.push({ id: this.nextId++, x: at.x, y: at.y, vx: 0, vy: 0, k, fuse: -1, holder: -1, owner: -1, flying: false, dead: false });
  }

  private spawnPickup(k: CratePickupKind, set = 0, weapon?: CrateWeapon): void {
    const at = this.randomSpot(60);
    if (!at) return;
    this.pickups.push({ id: this.nextId++, x: at.x, y: at.y, k, set, weapon });
    this.emit('spawn', at.x, at.y);
  }

  private wakePenguin(): void {
    if (!this.cfg.penguin || this.penguin.awake || this.penguin.rest > 0) return;
    this.penguin.awake = true;
    this.penguin.t = 0;
    this.penguin.a = this.rng() * Math.PI * 2;
    this.emit('spawn', CX, CY);
  }

  private hurt(p: P, dmg: number, kx = 0, ky = 0): void {
    if (!p.alive || p.invulnT > 0) return;
    p.invulnT = this.cfg.invulnTime;
    p.vx += kx;
    p.vy += ky;
    if (p.mask > 0) {
      p.mask = 0; // the mask takes the hit
      this.emit('crack', p.x, p.y, p.id);
      return;
    }
    p.hp -= dmg;
    p.boots = 0;
    this.emit('hit', p.x, p.y, p.id);
    if (p.hp <= 0) this.eliminate(p);
  }

  private eliminate(p: P): void {
    if (!p.alive) return;
    p.alive = false;
    p.hp = Math.max(0, p.hp);
    p.elimOrder = this.t; // simultaneous eliminations share a key and tie
    p.weightT = 0;
    p.weapon = '';
    p.charges = 0;
    if (p.hold) {
      p.hold.holder = -1;
      p.hold.vx = 0;
      p.hold.vy = 0;
      p.hold = null;
    }
    this.emit('eliminated', p.x, p.y, p.id);
  }

  // ---- simulation ---------------------------------------------------------
  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;

    for (const p of this.players) if (p.alive) this.stepPlayer(p, dt);
    this.separatePlayers();
    this.stepCrates(dt);
    this.processBlasts();
    this.stepShots(dt);
    this.stepPickups();
    if (this.cfg.penguin) this.stepPenguin(dt);
    this.stepSpawns(dt);

    for (const p of this.players) {
      if (!p.alive) continue;
      if (this.holeAt(p.x, p.y)) this.eliminate(p);
    }
    this.crates = this.crates.filter((c) => c.holder >= 0 || !this.holeAt(c.x, c.y));

    const alive = this.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
    if (this.standing.isOver(alive) || this.t >= this.cfg.timeLimit) this.finished = true;
  }

  private stepPlayer(p: P, dt: number): void {
    p.mask = Math.max(0, p.mask - dt);
    p.boots = Math.max(0, p.boots - dt);
    p.slow = Math.max(0, p.slow - dt);
    p.passCd = Math.max(0, p.passCd - dt);
    p.actCd = Math.max(0, p.actCd - dt);
    p.kickCd = Math.max(0, p.kickCd - dt);
    p.spinT = Math.max(0, p.spinT - dt);
    p.penguinCd = Math.max(0, p.penguinCd - dt);
    p.flingT = Math.max(0, p.flingT - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);

    if (p.weightT > 0) {
      p.weightT -= dt;
      if (p.weightT <= 0) {
        p.weightT = 0;
        p.hp = 0;
        this.emit('explode', p.x, p.y, p.id);
        this.eliminate(p);
        return;
      }
    }

    let { mx, my } = p.input;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const stick = len > 0.1;
    if (stick) p.facing = Math.atan2(my, mx);

    let top = SPEED;
    if (p.boots > 0) top *= BOOTS_SPEED;
    if (p.slow > 0) top *= Z_SPEED;
    if (p.hold) top *= CARRY_SLOW;
    const grip = this.cfg.slippery ? GRIP_ICE : GRIP;
    if (p.flingT > 0) {
      // thrown: glides on its momentum and slows down on its own, no steering
      const slow = Math.exp(-3 * dt);
      p.vx *= slow;
      p.vy *= slow;
    } else {
      const k = Math.min(1, grip * dt);
      p.vx += (mx * top - p.vx) * k;
      p.vy += (my * top - p.vy) * k;
    }
    p.x = clamp(p.x + p.vx * dt, X0 + PLAYER_R, X1 - PLAYER_R);
    p.y = clamp(p.y + p.vy * dt, Y0 + PLAYER_R, Y1 - PLAYER_R);
    if (this.cfg.solidCrates) this.resolveCrateSolids(p);

    // touching the penguin wakes him
    if (this.cfg.penguin && Math.hypot(p.x - CX, p.y - CY) < PLAYER_R + PENGUIN_R + 6) this.wakePenguin();

    const press = p.pressA1 || (p.input.a1 && !p.prevA1);
    p.pressA1 = false;
    p.prevA1 = p.input.a1;
    if (press && p.actCd <= 0) this.act(p);
    const kickPress = p.pressA2 || (p.input.a2 && !p.prevA2);
    p.pressA2 = false;
    p.prevA2 = p.input.a2;
    if (kickPress && p.kickCd <= 0) this.kick(p);
  }

  /** The first action button: weapon > throw the held crate > pick up a crate. (Kicking is the second button.) */
  private act(p: P): void {
    if (p.charges > 0 && p.weapon) {
      this.fireWeapon(p);
      p.actCd = 0.25;
      return;
    }
    if (p.hold) {
      const c = p.hold;
      p.hold = null;
      c.holder = -1;
      c.owner = p.idx;
      c.flying = true;
      c.x = p.x + Math.cos(p.facing) * (PLAYER_R + CRATE_R);
      c.y = p.y + Math.sin(p.facing) * (PLAYER_R + CRATE_R);
      c.vx = Math.cos(p.facing) * THROW_SPEED;
      c.vy = Math.sin(p.facing) * THROW_SPEED;
      if (c.k === 'tnt' && c.fuse < 0) c.fuse = this.cfg.tntFuse;
      p.actCd = this.cfg.pickupCooldown;
      this.emit('throw', p.x, p.y, p.id);
      return;
    }
    const c = this.crateInFront(p, this.cfg.pickupRange, false);
    if (c) {
      c.holder = p.idx;
      c.flying = false;
      c.vx = 0;
      c.vy = 0;
      if (c.k === 'tnt' && c.fuse < 0) c.fuse = this.cfg.tntFuse;
      p.hold = c;
      p.actCd = this.cfg.pickupCooldown;
      this.emit('pickup', c.x, c.y, p.id);
    }
  }

  /**
   * The crate a pick up would take: the nearest one within reach, preferring the ones the player faces; a crate
   * beside or behind still counts when nothing is in front (the stick direction is not a precise aim).
   */
  private crateInFront(p: P, range: number, any: boolean): C | null {
    let front: C | null = null;
    let frontD = Infinity;
    let near: C | null = null;
    let nearD = Infinity;
    for (const c of this.crates) {
      if (c.holder >= 0 || c.flying) continue;
      if (c.k === 'nitro' && !any) continue;
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range + CRATE_R) continue;
      if (d < nearD) {
        nearD = d;
        near = c;
      }
      if (d > 12 && (dx * Math.cos(p.facing) + dy * Math.sin(p.facing)) / d < 0.1) continue;
      if (d < frontD) {
        frontD = d;
        front = c;
      }
    }
    return front ?? near;
  }

  private kick(p: P): void {
    p.spinT = SPIN_TIME;
    p.kickCd = this.cfg.kickCooldown;
    this.emit('kick', p.x, p.y, p.id);
    if (this.cfg.penguin && Math.hypot(p.x - CX, p.y - CY) < this.cfg.kickRange + PENGUIN_R) this.wakePenguin();
    for (const q of this.players) {
      if (q === p || !q.alive) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > this.cfg.kickRange) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      this.hurt(q, KICK_DAMAGE, nx * KICK_KNOCK, ny * KICK_KNOCK);
    }
    for (const c of this.crates) {
      if (c.holder >= 0 || c.k === 'nitro') continue;
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > this.cfg.kickRange + CRATE_R) continue;
      const nx = d > 1e-6 ? dx / d : Math.cos(p.facing);
      const ny = d > 1e-6 ? dy / d : Math.sin(p.facing);
      c.vx = nx * KICK_SPEED;
      c.vy = ny * KICK_SPEED;
      c.flying = true;
      c.owner = p.idx;
      if (c.k === 'tnt' && c.fuse < 0) c.fuse = this.cfg.tntFuse;
    }
  }

  private fireWeapon(p: P): void {
    const w = p.weapon as CrateWeapon;
    p.charges--;
    if (p.charges <= 0) {
      p.weapon = '';
      p.charges = 0;
    }
    if (w === 'ring') {
      this.shots.push({ id: this.nextId++, x: p.x, y: p.y, vx: 0, vy: 0, k: 'ring', owner: p.idx, life: 0.5 });
      this.emit('explode', p.x, p.y, p.id);
      for (const q of this.players) {
        if (q === p || !q.alive) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > RING_RANGE) continue;
        this.hurt(q, RING_DAMAGE, (dx / (d || 1)) * 500, (dy / (d || 1)) * 500);
      }
      for (const c of this.crates) {
        if (c.holder >= 0 || c.k === 'nitro') continue;
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > RING_RANGE + 20) continue;
        c.vx = (dx / (d || 1)) * KICK_SPEED;
        c.vy = (dy / (d || 1)) * KICK_SPEED;
        c.flying = true;
        c.owner = p.idx;
        if (c.k === 'tnt' && c.fuse < 0) c.fuse = this.cfg.tntFuse;
      }
    } else if (w === 'missile') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        this.shots.push({
          id: this.nextId++,
          x: p.x + Math.cos(a) * 30,
          y: p.y + Math.sin(a) * 30,
          vx: Math.cos(a) * MISSILE_SPEED,
          vy: Math.sin(a) * MISSILE_SPEED,
          k: 'missile',
          owner: p.idx,
          life: SHOT_LIFE,
        });
      }
      this.emit('rocket', p.x, p.y, p.id);
    } else {
      this.shots.push({
        id: this.nextId++,
        x: p.x + Math.cos(p.facing) * 30,
        y: p.y + Math.sin(p.facing) * 30,
        vx: Math.cos(p.facing) * ORB_SPEED,
        vy: Math.sin(p.facing) * ORB_SPEED,
        k: 'orb',
        owner: p.idx,
        life: ORB_LIFE,
      });
      this.emit('zap', p.x, p.y, p.id);
    }
  }

  private separatePlayers(): void {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = PLAYER_R * 2;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        const o = (min - d) / 2;
        a.x -= nx * o;
        a.y -= ny * o;
        b.x += nx * o;
        b.y += ny * o;
        // the weight is passed on by touch
        if (a.weightT > 0 && b.weightT <= 0 && a.passCd <= 0) this.passWeight(a, b);
        else if (b.weightT > 0 && a.weightT <= 0 && b.passCd <= 0) this.passWeight(b, a);
      }
    }
  }

  private passWeight(from: P, to: P): void {
    to.weightT = from.weightT;
    from.weightT = 0;
    to.passCd = 1.2;
    this.emit('pickup', to.x, to.y, to.id);
  }

  /** Push the player out of resting crates (nitro is never solid: it explodes on touch). */
  private resolveCrateSolids(p: P): void {
    const min = PLAYER_R + CRATE_R;
    for (const c of this.crates) {
      if (c.holder >= 0 || c.flying || c.k === 'nitro') continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const nx = d > 0.001 ? dx / d : 1;
      const ny = d > 0.001 ? dy / d : 0;
      p.x = clamp(c.x + nx * min, X0 + PLAYER_R, X1 - PLAYER_R);
      p.y = clamp(c.y + ny * min, Y0 + PLAYER_R, Y1 - PLAYER_R);
      const into = p.vx * nx + p.vy * ny;
      if (into < 0) {
        p.vx -= into * nx;
        p.vy -= into * ny;
      }
    }
  }

  private stepCrates(dt: number): void {
    for (const c of this.crates) {
      if (c.holder >= 0) {
        const h = this.players[c.holder];
        c.x = h.x + Math.cos(h.facing) * HOLD_DIST;
        c.y = h.y + Math.sin(h.facing) * HOLD_DIST;
      } else if (c.flying || c.vx !== 0 || c.vy !== 0) {
        const damp = Math.exp(-CRATE_FRICTION * dt);
        c.vx *= damp;
        c.vy *= damp;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const sp = Math.hypot(c.vx, c.vy);
        if (sp < FLY_MIN) {
          c.flying = false;
          c.bounce = false;
          if (sp < 20) {
            c.vx = 0;
            c.vy = 0;
          }
        }
        // walls: soft crates break, TNT bounces
        const hitX = c.x < X0 + CRATE_R || c.x > X1 - CRATE_R;
        const hitY = c.y < Y0 + CRATE_R || c.y > Y1 - CRATE_R;
        if (hitX || hitY) {
          if (c.flying && !c.bounce && (c.k === 'block' || c.k === 'locked')) {
            this.breakCrate(c);
            continue;
          }
          c.x = clamp(c.x, X0 + CRATE_R, X1 - CRATE_R);
          c.y = clamp(c.y, Y0 + CRATE_R, Y1 - CRATE_R);
          if (hitX) c.vx *= -0.6;
          if (hitY) c.vy *= -0.6;
        }
      }

      if (c.fuse >= 0) {
        c.fuse -= dt;
        if (c.fuse <= 0 && !this.blasts.includes(c)) this.blasts.push(c);
      }

      if (c.holder >= 0) continue;

      if (c.flying) {
        if (this.cfg.penguin && Math.hypot(c.x - CX, c.y - CY) < CRATE_R + PENGUIN_R + 10) this.wakePenguin();
        // hit a rival
        for (const q of this.players) {
          if (!q.alive || q.idx === c.owner) continue;
          if (Math.hypot(q.x - c.x, q.y - c.y) > PLAYER_R + CRATE_R) continue;
          if (c.k === 'tnt') {
            if (!this.blasts.includes(c)) this.blasts.push(c);
          } else {
            const d = Math.hypot(c.vx, c.vy) || 1;
            this.hurt(q, DAMAGE[c.k], (c.vx / d) * 300, (c.vy / d) * 300);
            this.breakCrate(c);
          }
          break;
        }
        if (this.cfg.solidCrates && this.crates.includes(c)) this.bumpCrates(c);
        // hit a nitro crate
        if (this.crates.includes(c)) {
          for (const n of this.crates) {
            if (n.k !== 'nitro' || n === c) continue;
            if (Math.hypot(n.x - c.x, n.y - c.y) < CRATE_R * 2) {
              if (!this.blasts.includes(n)) this.blasts.push(n);
              this.breakCrate(c);
              break;
            }
          }
        }
      } else if (c.k === 'nitro') {
        // touching nitro is deadly
        for (const q of this.players) {
          if (!q.alive) continue;
          if (Math.hypot(q.x - c.x, q.y - c.y) < PLAYER_R + CRATE_R - 2) {
            if (!this.blasts.includes(c)) this.blasts.push(c);
            break;
          }
        }
      }
    }
    this.crates = this.crates.filter((c) => !c.dead);
  }

  /** A moving crate shoves the resting crates it runs into (equal masses: the normal speed is handed over). */
  private bumpCrates(c: C): void {
    const min = CRATE_R * 2;
    for (const o of this.crates) {
      if (o === c || o.dead || o.holder >= 0 || o.k === 'nitro') continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const nx = d > 0.001 ? dx / d : 1;
      const ny = d > 0.001 ? dy / d : 0;
      const vn = (c.vx - o.vx) * nx + (c.vy - o.vy) * ny;
      if (vn <= 0) continue; // already separating
      c.vx -= vn * nx;
      c.vy -= vn * ny;
      o.vx += vn * nx;
      o.vy += vn * ny;
      o.x = clamp(c.x + nx * min, X0 + CRATE_R, X1 - CRATE_R);
      o.y = clamp(c.y + ny * min, Y0 + CRATE_R, Y1 - CRATE_R);
      o.flying = true;
      o.owner = c.owner;
      if (o.k === 'tnt' && o.fuse < 0) o.fuse = this.cfg.tntFuse;
      this.emit('crack', o.x, o.y);
    }
  }

  private breakCrate(c: C): void {
    c.dead = true;
    this.emit('crack', c.x, c.y);
    if (c.holder >= 0) {
      const h = this.players[c.holder];
      if (h.hold === c) h.hold = null;
    }
  }

  /** Explosions, resolved as a queue so chain reactions can't recurse. */
  private processBlasts(): void {
    let guard = 0;
    while (this.blasts.length > 0 && guard++ < 40) {
      const c = this.blasts.shift()!;
      if (c.dead) continue;
      this.explode(c);
    }
    this.crates = this.crates.filter((c) => !c.dead);
  }

  private explode(c: C): void {
    c.dead = true;
    if (c.holder >= 0) {
      const h = this.players[c.holder];
      if (h.hold === c) h.hold = null;
    }
    const R = c.k === 'nitro' ? this.cfg.blastRadius * 0.8 : this.cfg.blastRadius;
    const dmg = c.k === 'nitro' ? DAMAGE.nitro : this.cfg.tntDamage;
    this.emit('explode', c.x, c.y);
    for (const q of this.players) {
      if (!q.alive) continue;
      const dx = q.x - c.x;
      const dy = q.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d > R + PLAYER_R) continue;
      this.hurt(q, dmg, (dx / (d || 1)) * 520, (dy / (d || 1)) * 520);
    }
    for (const o of this.crates) {
      if (o === c || o.dead) continue;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d > R) continue;
      if (o.k === 'nitro') this.blasts.push(o);
      else if (o.k === 'tnt') o.fuse = o.fuse < 0 ? 0.25 : Math.min(o.fuse, 0.25);
      else if (o.holder < 0) this.breakCrate(o);
    }
    if (this.cfg.floorHoles) {
      for (let r = 0; r < GRID; r++) {
        for (let col = 0; col < GRID; col++) {
          const tx = X0 + (col + 0.5) * TILE;
          const ty = Y0 + (r + 0.5) * TILE;
          if (Math.hypot(tx - c.x, ty - c.y) <= R * 0.75) this.holes[r * GRID + col] = 1;
        }
      }
    }
    if (this.cfg.penguin && Math.hypot(c.x - CX, c.y - CY) < R + PENGUIN_R) this.wakePenguin();
  }

  private stepShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      if (s.k === 'ring') {
        if (s.life <= 0) this.shots.splice(i, 1);
        continue;
      }
      if (s.k === 'orb') {
        // steer toward the nearest rival
        let best: P | null = null;
        let bd = Infinity;
        for (const q of this.players) {
          if (!q.alive || q.idx === s.owner) continue;
          const d = Math.hypot(q.x - s.x, q.y - s.y);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        if (best) {
          const want = Math.atan2(best.y - s.y, best.x - s.x);
          const cur = Math.atan2(s.vy, s.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = clamp(diff, -3.2 * dt, 3.2 * dt);
          s.vx = Math.cos(cur + turn) * ORB_SPEED;
          s.vy = Math.sin(cur + turn) * ORB_SPEED;
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let gone = s.life <= 0 || s.x < X0 || s.x > X1 || s.y < Y0 || s.y > Y1;
      if (!gone) {
        for (const q of this.players) {
          if (!q.alive || q.idx === s.owner) continue;
          if (Math.hypot(q.x - s.x, q.y - s.y) > PLAYER_R + 10) continue;
          const d = Math.hypot(s.vx, s.vy) || 1;
          this.hurt(q, s.k === 'orb' ? ORB_DAMAGE : MISSILE_DAMAGE, (s.vx / d) * 280, (s.vy / d) * 280);
          gone = true;
          break;
        }
      }
      if (gone) this.shots.splice(i, 1);
    }
  }

  private stepPickups(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const it = this.pickups[i];
        if (Math.hypot(p.x - it.x, p.y - it.y) > PLAYER_R + 20) continue;
        if (it.k === 'qbox') {
          if (p.charges > 0) continue; // one weapon at a time
          // opening a ? crate: the other three of its set vanish when the weapon is found
          this.pickups.splice(i, 1);
          if (it.weapon) {
            p.weapon = it.weapon;
            p.charges = CHARGES[it.weapon];
            this.pickups = this.pickups.filter((o) => !(o.k === 'qbox' && o.set === it.set));
            this.emit('pickup', it.x, it.y, p.id);
          } else {
            this.heal(p);
          }
          break;
        }
        this.pickups.splice(i, 1);
        switch (it.k) {
          case 'berry':
            this.heal(p);
            break;
          case 'mask':
            p.mask = MASK_TIME;
            this.emit('pickup', it.x, it.y, p.id);
            break;
          case 'boots':
            p.boots = BOOTS_TIME;
            p.slow = 0;
            this.emit('pickup', it.x, it.y, p.id);
            break;
          case 'z':
            p.slow = Z_TIME;
            p.boots = 0;
            this.emit('pickup', it.x, it.y, p.id);
            break;
          case 'weight':
            p.weightT = this.cfg.weightTime;
            p.passCd = 1;
            this.emit('pickup', it.x, it.y, p.id);
            break;
        }
        break;
      }
    }
  }

  private heal(p: P): void {
    if (p.hp < this.cfg.maxHp) {
      p.hp = Math.min(this.cfg.maxHp, p.hp + BERRY_HEAL);
      this.emit('heal', p.x, p.y, p.id);
    }
  }

  private stepPenguin(dt: number): void {
    const g = this.penguin;
    g.rest = Math.max(0, g.rest - dt);
    if (!g.awake) return;
    g.t += dt;
    g.a += PENGUIN_SPIN * dt;
    if (g.t >= this.cfg.penguinTime) {
      g.awake = false;
      g.rest = PENGUIN_REST;
      return;
    }
    const prog = g.t / this.cfg.penguinTime;
    const R = PENGUIN_ORBIT * Math.sin(Math.PI * Math.min(1, prog * 1.0));
    const x = CX + Math.cos(g.a) * R;
    const y = CY + Math.sin(g.a) * R;
    for (const p of this.players) {
      if (!p.alive || p.penguinCd > 0) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > PLAYER_R + PENGUIN_R) continue;
      p.penguinCd = 0.9;
      // thrown outward, away from the penguin
      const [nx, ny] = d > 1e-3 ? [(p.x - x) / d, (p.y - y) / d] : [Math.cos(g.a), Math.sin(g.a)];
      this.hurt(p, 2);
      if (p.alive) {
        p.vx = nx * PLAYER_FLING;
        p.vy = ny * PLAYER_FLING;
        p.flingT = FLING_TIME;
        this.emit('bump', p.x, p.y, p.id);
      }
    }
    // anything it touches is flung outward, not destroyed
    for (const c of this.crates) {
      if (c.holder >= 0 || c.dead) continue;
      const dx = c.x - x;
      const dy = c.y - y;
      const d = Math.hypot(dx, dy);
      if (d > CRATE_R + PENGUIN_R) continue;
      // away from the penguin (from the arena centre when exactly on it)
      const [nx, ny] = d > 1e-3 ? [dx / d, dy / d] : [Math.cos(g.a), Math.sin(g.a)];
      if (c.flying && c.vx * nx + c.vy * ny >= PENGUIN_THROW * 0.9) continue; // already on its way out
      const edge = CRATE_R + PENGUIN_R + 4;
      c.x = x + nx * edge;
      c.y = y + ny * edge;
      c.vx = nx * PENGUIN_THROW;
      c.vy = ny * PENGUIN_THROW;
      c.flying = true;
      c.bounce = true;
      c.owner = -1;
      if (c.k === 'tnt' && c.fuse < 0) c.fuse = this.cfg.tntFuse;
      this.emit('kick', c.x, c.y);
    }
  }

  private stepSpawns(dt: number): void {
    const cfg = this.cfg;
    this.crateTimer -= dt;
    if (this.crateTimer <= 0) {
      this.crateTimer = nextIn(this.rng, cfg.crateEvery, cfg.crateVariance, 1);
      if (this.crates.length < MAX_CRATES) this.dropCrate();
    }
    this.berryTimer -= dt;
    if (this.berryTimer <= 0) {
      this.berryTimer = nextIn(this.rng, cfg.berryEvery, cfg.berryVariance, 1);
      if (this.pickups.filter((i) => i.k === 'berry').length < MAX_BERRY) this.spawnPickup('berry');
    }
    if (cfg.powerups) {
      this.powerTimer -= dt;
      if (this.powerTimer <= 0) {
        this.powerTimer = nextIn(this.rng, cfg.powerupEvery, cfg.powerupVariance, 1);
        const loose = this.pickups.filter((i) => i.k !== 'berry' && i.k !== 'qbox').length;
        if (loose < MAX_POWERUPS) {
          const weightInPlay = this.players.some((p) => p.weightT > 0) || this.pickups.some((i) => i.k === 'weight');
          const pool: CratePickupKind[] = weightInPlay ? ['mask', 'boots', 'z'] : ['mask', 'boots', 'z', 'weight'];
          this.spawnPickup(pick(pool, this.rng));
        }
      }
    }
    if (cfg.qboxes) {
      this.boxTimer -= dt;
      if (this.boxTimer <= 0 && !this.pickups.some((i) => i.k === 'qbox')) {
        this.boxTimer = nextIn(this.rng, cfg.boxEvery, cfg.boxVariance, 1);
        const set = this.nextSet++;
        const weaponAt = Math.floor(this.rng() * 4);
        const weapon = pick<CrateWeapon>(['ring', 'missile', 'orb'], this.rng);
        for (let i = 0; i < 4; i++) this.spawnPickup('qbox', set, i === weaponAt ? weapon : undefined);
      }
    }
  }

  // ---- Minigame output ----------------------------------------------------
  getState(): CrateState {
    const players: CratePlayerState[] = this.players.map((p) => ({
      id: p.id,
      x: r1(p.x),
      y: r1(p.y),
      f: r2(p.facing),
      hp: r1(Math.max(0, p.hp)),
      alive: p.alive,
      hold: p.hold ? p.hold.k : '',
      target: p.alive && !p.hold ? (this.crateInFront(p, this.cfg.pickupRange, false)?.id ?? -1) : -1,
      holdFuse: p.hold && p.hold.fuse >= 0 ? r2(Math.max(0, p.hold.fuse)) : -1,
      mask: r2(Math.min(1, p.mask / MASK_TIME)),
      inv: p.invulnT > 0,
      boots: r2(Math.min(1, p.boots / BOOTS_TIME)),
      slow: r2(Math.min(1, p.slow / Z_TIME)),
      weight: r2(Math.min(1, p.weightT / this.cfg.weightTime)),
      weapon: p.weapon,
      charges: p.charges,
      spin: p.spinT > 0,
    }));
    const state: CrateState = {
      kind: 'ext:box-bonanza',
      variant: this.cfg.variant,
      t: r1(this.t),
      limit: this.cfg.timeLimit,
      maxHp: this.cfg.maxHp,
      tntFuse: this.cfg.tntFuse,
      weightTime: this.cfg.weightTime,
      blastRadius: this.cfg.blastRadius,
      tiles: this.cfg.floorHoles ? GRID : 0,
      holes: this.cfg.floorHoles ? this.holes.slice() : [],
      players,
      crates: this.crates
        .filter((c) => c.holder < 0)
        .map((c) => ({
          id: c.id,
          x: r1(c.x),
          y: r1(c.y),
          k: c.k,
          fuse: c.fuse < 0 ? -1 : r2(Math.max(0, c.fuse)),
          moving: c.flying,
        })),
      pickups: this.pickups.map((i) => ({ id: i.id, x: r1(i.x), y: r1(i.y), k: i.k })),
      shots: this.shots.map((s) => ({ id: s.id, x: r1(s.x), y: r1(s.y), k: s.k })),
    };
    if (this.cfg.penguin) {
      const g = this.penguin;
      const prog = g.awake ? g.t / this.cfg.penguinTime : 0;
      const R = g.awake ? PENGUIN_ORBIT * Math.sin(Math.PI * Math.min(1, prog)) : 0;
      state.penguin = { x: r1(CX + Math.cos(g.a) * R), y: r1(CY + Math.sin(g.a) * R), a: r2(g.a), awake: g.awake };
    }
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
    // survivors outrank the eliminated; among survivors more health is better
    const ranked = this.players
      .map((p) => ({ id: p.id, key: p.alive ? 1000 + p.hp : p.elimOrder }))
      .sort((a, b) => b.key - a.key);
    let place = 0;
    let prev = -1;
    return ranked.map((r, i) => {
      if (r.key !== prev) place = i + 1;
      prev = r.key;
      return { id: r.id, place };
    });
  }
}
