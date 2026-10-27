import { nextIn, pick, r1, r2 } from '../../../core/shared/kit/util';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../core/shared/plugin-api';
import { NO_INPUT, type GameEvent, type GameEventKind, type InputState } from '../../../core/shared/types';
import { pogoTileCenter } from '../shared/geometry';
import type { PogoItemKind, PogoPlayerState, PogoState } from '../shared/types';
import { POGO_DEFAULTS, type PogoConfig } from './config';
import { enclosedTiles } from './loops';

// exported constants: the bot (bot/) plans with them, so they cannot drift apart
export const DX = [0, 1, 0, -1]; // facing: 0 up, 1 right, 2 down, 3 left
export const DY = [-1, 0, 1, 0];
export const DIR_BIT = [1, 2, 4, 8];

const BOOTS_TIME = 8;
export const BOOTS_FACTOR = 0.55; // hop time multiplier
export const MISSILE_SPEED = 13; // tiles/s
const BEAM_TIME = 0.4; // s the lightning stays on screen

/** Zap Beam: the whole row or column ahead of a hopper facing `dir` (everyone ahead in the facing line). */
export function inBeam(c: number, r: number, dir: number, qc: number, qr: number): boolean {
  const dc = qc - c;
  const dr = qr - r;
  return DX[dir] !== 0 ? dr === 0 && dc * DX[dir] > 0 : dc === 0 && dr * DY[dir] > 0;
}
const MAX_CRATES = 2;
const MAX_ITEMS = 7;
const SPAWN_MIN_GAP = 1; // s
const MUSHROOM_TTL = 9;
const PADLOCK_STEP = 1.4;
const PADLOCK_RESPAWN = 6;
const BOMBER_SPEED = 3.4; // tiles/s along the perimeter
const BOMBER_OFFSET = 0.9;

interface P {
  id: string;
  idx: number;
  c: number;
  r: number;
  pc: number;
  pr: number;
  hopT: number;
  hopDur: number;
  hopping: boolean;
  facing: number;
  score: number;
  item: '' | 'missile' | 'beam';
  bootsT: number;
  lockT: number;
  stunT: number;
  /** hit protection: covers the freeze plus cfg.invulnTime after it */
  invulnT: number;
  gone: boolean;
  /** disconnect order (1 = first to leave), 0 while connected: leavers place below everyone connected */
  left: number;
  prevA1: boolean;
  input: InputState;
}

interface Item {
  id: number;
  c: number;
  r: number;
  k: PogoItemKind;
  d: number;
  ttl: number;
}

interface Missile {
  id: number;
  x: number;
  y: number;
  dir: number;
  /** player index, or -1 for Blast Bot */
  owner: number;
}


export class SpringShowdown implements Minigame {
  readonly id: string;
  readonly name = 'Spring Showdown';

  private readonly n: number;
  private players: P[] = [];
  private byId = new Map<string, P>();
  private tiles: number[] = [];
  private items: Item[] = [];
  private missiles: Missile[] = [];
  private beams: { c: number; r: number; dir: number; t: number }[] = [];
  private events: GameEvent[] = [];
  private t = 0;
  private nextId = 1;
  private itemTimer = 0;
  private crateTimer = 0;
  private padlockCd = 0;
  private padlockStep = 0;
  private bomberU = 0;
  private rooTimer = 0;
  private bomberStep = 0;
  private finished = false;
  private leaveSeq = 0;

  constructor(
    private readonly cfg: PogoConfig = POGO_DEFAULTS,
    private readonly rng: () => number = Math.random,
  ) {
    this.id = cfg.variant;
    this.n = Math.max(6, Math.round(cfg.gridSize));
  }

  init(players: MinigamePlayer[]): void {
    const n = this.n;
    this.players = [];
    this.byId.clear();
    this.tiles = new Array<number>(n * n).fill(-1);
    this.items = [];
    this.missiles = [];
    this.beams = [];
    this.events = [];
    this.t = 0;
    this.leaveSeq = 0;
    this.nextId = 1;
    this.itemTimer = this.cfg.itemEvery * 0.4;
    this.crateTimer = this.cfg.crateEvery * 0.3;
    this.padlockCd = 3;
    this.padlockStep = PADLOCK_STEP;
    this.bomberU = 0;
    this.rooTimer = this.cfg.tntEvery;
    this.bomberStep = 0;
    this.finished = false;

    const count = players.length;
    players.forEach((pl, i) => {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2;
      const rad = n / 2 - 1.5;
      const c = Math.min(n - 1, Math.max(0, Math.round(n / 2 - 0.5 + Math.cos(a) * rad)));
      const r = Math.min(n - 1, Math.max(0, Math.round(n / 2 - 0.5 + Math.sin(a) * rad)));
      const p: P = {
        id: pl.id,
        idx: i,
        c,
        r,
        pc: c,
        pr: r,
        hopT: 0,
        hopDur: this.cfg.hopTime,
        hopping: false,
        facing: ((Math.round(a / (Math.PI / 2)) + 2 + 4) % 4 + 4) % 4,
        score: 0,
        item: '',
        bootsT: 0,
        lockT: 0,
        stunT: 0,
        invulnT: 0,
        gone: false,
        left: 0,
        prevA1: false,
        input: NO_INPUT,
      };
      this.tiles[r * n + c] = i;
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
    if (!p || p.gone) return;
    p.gone = true;
    p.left = ++this.leaveSeq;
    p.item = '';
    p.hopping = false;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === p.idx) this.tiles[i] = -1;
  }

  // ---- helpers ------------------------------------------------------------
  private emit(kind: GameEventKind, c: number, r: number, id = ''): void {
    const [x, y] = pogoTileCenter(c, r, this.n);
    this.events.push({ kind, id, x: r1(x), y: r1(y) });
  }

  private countTiles(idx: number): number {
    let k = 0;
    for (const o of this.tiles) if (o === idx) k++;
    return k;
  }

  private tileOf(p: P): [number, number] {
    return p.hopping && p.hopT < p.hopDur / 2 ? [p.pc, p.pr] : [p.c, p.r];
  }

  /** another player stands on, is hopping onto, or is still leaving (c, r) */
  private occupied(c: number, r: number, except: P): boolean {
    for (const q of this.players) {
      if (q === except || q.gone) continue;
      if ((q.c === c && q.r === r) || (q.hopping && q.pc === c && q.pr === r)) return true;
    }
    return false;
  }

  private itemAt(c: number, r: number): Item | undefined {
    return this.items.find((i) => i.c === c && i.r === r);
  }

  private freeTile(): [number, number] | null {
    for (let tries = 0; tries < 40; tries++) {
      const c = Math.floor(this.rng() * this.n);
      const r = Math.floor(this.rng() * this.n);
      if (this.itemAt(c, r)) continue;
      if (this.players.some((p) => !p.gone && ((p.c === c && p.r === r) || (p.pc === c && p.pr === r)))) continue;
      return [c, r];
    }
    return null;
  }

  private spawn(k: PogoItemKind, ttl = Infinity, d = 0): Item | null {
    const at = this.freeTile();
    if (!at) return null;
    const it: Item = { id: this.nextId++, c: at[0], r: at[1], k, d, ttl };
    this.items.push(it);
    this.emit('spawn', it.c, it.r);
    return it;
  }

  private arrowMask(): number {
    if (this.cfg.arrows === 'two' && this.rng() < 0.5) return pick([5, 10], this.rng); // vertical or horizontal
    return DIR_BIT[Math.floor(this.rng() * 4)];
  }

  private stun(p: P, secs: number): void {
    if (p.invulnT > 0) return;
    p.stunT = Math.max(p.stunT, secs);
    p.invulnT = secs + this.cfg.invulnTime;
    p.bootsT = 0;
    p.item = '';
    const [c, r] = this.tileOf(p);
    this.emit('stun', c, r, p.id);
  }

  /** a square owned by a player whose padlock is active can't be converted */
  private isLocked(i: number): boolean {
    const o = this.tiles[i];
    return o >= 0 && this.players[o].lockT > 0;
  }

  private paint(idx: number, c: number, r: number): void {
    const i = r * this.n + c;
    const o = this.tiles[i];
    if (o === idx) return;
    if (this.isLocked(i)) return; // padlocked squares can't be converted
    this.tiles[i] = idx;
  }

  private bank(p: P, c: number, r: number): void {
    const k = this.countTiles(p.idx);
    if (k === 0) return;
    p.score += k;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === p.idx) this.tiles[i] = -1;
    this.emit('bank', c, r, p.id);
  }

  // ---- simulation ---------------------------------------------------------
  update(dt: number): void {
    if (this.finished) return;
    this.t += dt;

    for (const p of this.players) if (!p.gone) this.stepPlayer(p, dt);
    this.stepMissiles(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) if ((this.beams[i].t -= dt) <= 0) this.beams.splice(i, 1);
    this.stepSpawns(dt);
    if (this.cfg.bomber) this.stepBomber(dt);
    if (this.cfg.padlock) this.stepPadlock(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.ttl -= dt;
      if (it.ttl > 0) continue;
      this.items.splice(i, 1);
      if (it.k === 'tnt') this.explode(it);
    }

    const everyoneGone = this.players.length > 0 && this.players.every((p) => p.gone);
    if (this.t >= this.cfg.timeLimit || everyoneGone) this.finished = true;
  }

  private stepPlayer(p: P, dt: number): void {
    p.stunT = Math.max(0, p.stunT - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.bootsT = Math.max(0, p.bootsT - dt);
    p.lockT = Math.max(0, p.lockT - dt);

    let { mx, my } = p.input;
    if (Math.hypot(mx, my) > 0.3) {
      p.facing = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 1 : 3) : my > 0 ? 2 : 0;
    } else {
      mx = 0;
      my = 0;
    }

    const press = p.input.a1 && !p.prevA1;
    p.prevA1 = p.input.a1;
    if (press && p.stunT <= 0) this.useItem(p);

    if (p.hopping) {
      p.hopT += dt;
      if (p.hopT >= p.hopDur) {
        p.hopping = false;
        this.land(p);
      }
    }
    if (!p.hopping && p.stunT <= 0 && (mx !== 0 || my !== 0)) {
      const nc = p.c + DX[p.facing];
      const nr = p.r + DY[p.facing];
      if (nc >= 0 && nr >= 0 && nc < this.n && nr < this.n && !(this.cfg.collisions && this.occupied(nc, nr, p))) {
        p.pc = p.c;
        p.pr = p.r;
        p.c = nc;
        p.r = nr;
        p.hopT = 0;
        p.hopDur = this.cfg.hopTime * (p.bootsT > 0 ? BOOTS_FACTOR : 1);
        p.hopping = true;
      }
    }
  }

  private useItem(p: P): void {
    const [c, r] = this.tileOf(p);
    if (p.item === 'missile') {
      p.item = '';
      const dirs = this.cfg.fourWayMissile ? [0, 1, 2, 3] : [p.facing];
      for (const d of dirs) {
        this.missiles.push({ id: this.nextId++, x: c + 0.5 + DX[d] * 0.5, y: r + 0.5 + DY[d] * 0.5, dir: d, owner: p.idx });
      }
      this.emit('rocket', c, r, p.id);
    } else if (p.item === 'beam') {
      p.item = '';
      for (const q of this.players) {
        if (q === p || q.gone) continue;
        const [qc, qr] = this.tileOf(q);
        if (inBeam(c, r, p.facing, qc, qr)) this.stun(q, this.cfg.stunTime);
      }
      this.beams.push({ c, r, dir: p.facing, t: BEAM_TIME });
      this.emit('zap', c, r, p.id);
    }
  }

  /** Landing effects, in order: paint / wipe, arrow, enclosure, then the item on the tile. */
  private land(p: P): void {
    const { c, r } = p;
    const i = r * this.n + c;
    if (this.cfg.selfWipe && this.tiles[i] === p.idx) {
      if (p.lockT <= 0) {
        for (let j = 0; j < this.tiles.length; j++) if (this.tiles[j] === p.idx) this.tiles[j] = -1;
        this.emit('wipe', c, r, p.id);
      }
    } else {
      this.paint(p.idx, c, r);
    }

    const it = this.itemAt(c, r);
    if (it?.k === 'arrow') {
      this.applyArrow(p, c, r, it.d);
      this.items.splice(this.items.indexOf(it), 1);
    }
    if (this.cfg.fillEnclosed) this.enclose(p, c, r);

    if (!it || it.k === 'arrow') return;
    this.items.splice(this.items.indexOf(it), 1);
    switch (it.k) {
      case 'crate':
        if (this.cfg.scoreBy === 'crates') this.bank(p, c, r);
        break;
      case 'boots':
        p.bootsT = BOOTS_TIME;
        this.emit('pickup', c, r, p.id);
        break;
      case 'missile':
      case 'beam':
        p.item = it.k;
        this.emit('pickup', c, r, p.id);
        break;
      case 'padlock':
        p.lockT = this.cfg.padlockTime;
        this.padlockCd = PADLOCK_RESPAWN;
        this.emit('pickup', c, r, p.id);
        break;
      case 'mushroom':
        this.stun(p, this.cfg.stunTime * 0.6);
        break;
      case 'tnt':
        this.stun(p, this.cfg.stunTime);
        this.emit('tnt', c, r, p.id);
        break;
    }
  }

  /** a TNT fuse ran out: wipe the colour and stun everyone within `tntRadius` squares of it */
  private explode(it: Item): void {
    const R = this.cfg.tntRadius;
    for (let r = Math.max(0, it.r - R); r <= Math.min(this.n - 1, it.r + R); r++) {
      for (let c = Math.max(0, it.c - R); c <= Math.min(this.n - 1, it.c + R); c++) {
        const i = r * this.n + c;
        if (!this.isLocked(i)) this.tiles[i] = -1;
      }
    }
    for (const q of this.players) {
      if (q.gone) continue;
      const [qc, qr] = this.tileOf(q);
      if (Math.abs(qc - it.c) <= R && Math.abs(qr - it.r) <= R) this.stun(q, this.cfg.stunTime);
    }
    this.emit('boom', it.c, it.r);
  }

  private applyArrow(p: P, c: number, r: number, mask: number): void {
    for (let d = 0; d < 4; d++) {
      if (!(mask & DIR_BIT[d])) continue;
      for (let k = 1; k < this.n; k++) {
        const x = c + DX[d] * k;
        const y = r + DY[d] * k;
        if (x < 0 || y < 0 || x >= this.n || y >= this.n) break;
        this.paint(p.idx, x, y);
      }
    }
    this.emit('fill', c, r, p.id);
  }

  private enclose(p: P, c: number, r: number): void {
    const inside = enclosedTiles(this.tiles, this.n, p.idx).filter((i) => !this.isLocked(i));
    if (inside.length === 0) return;
    for (const i of inside) this.tiles[i] = p.idx;
    this.emit('fill', c, r, p.id);
    if (this.cfg.scoreBy === 'enclose') this.bank(p, c, r);
  }

  private stepMissiles(dt: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.x += DX[m.dir] * MISSILE_SPEED * dt;
      m.y += DY[m.dir] * MISSILE_SPEED * dt;
      const c = Math.floor(m.x);
      const r = Math.floor(m.y);
      if (c < 0 || r < 0 || c >= this.n || r >= this.n) {
        this.missiles.splice(i, 1);
        continue;
      }
      const victim = this.players.find((q) => {
        if (q.gone || q.idx === m.owner) return false;
        const [qc, qr] = this.tileOf(q);
        return qc === c && qr === r;
      });
      if (!victim) continue;
      this.missiles.splice(i, 1);
      const protectedNow = victim.invulnT > 0;
      this.stun(victim, this.cfg.stunTime);
      if (this.cfg.steal && m.owner >= 0 && victim.lockT <= 0 && !protectedNow) {
        for (let j = 0; j < this.tiles.length; j++) if (this.tiles[j] === victim.idx) this.tiles[j] = m.owner;
        this.emit('fill', c, r, this.players[m.owner].id);
      }
    }
  }

  /** Seconds until the next spawn: interval +- variance, never less than SPAWN_MIN_GAP. */
  private nextIn(every: number, variance: number): number {
    return nextIn(this.rng, every, variance, SPAWN_MIN_GAP);
  }

  private stepSpawns(dt: number): void {
    const cfg = this.cfg;
    this.itemTimer -= dt;
    if (this.itemTimer <= 0) {
      this.itemTimer = this.nextIn(cfg.itemEvery, cfg.itemVariance);
      const pool: PogoItemKind[] = ['boots', 'missile'];
      if (cfg.beam) pool.push('beam');
      if (cfg.arrows !== 'none') pool.push('arrow', 'arrow');
      if (cfg.mushrooms) pool.push('mushroom');
      const loose = this.items.filter((i) => i.k !== 'crate' && i.k !== 'padlock').length;
      if (loose < MAX_ITEMS) {
        const k = pick(pool, this.rng);
        this.spawn(k, k === 'mushroom' ? MUSHROOM_TTL : Infinity, k === 'arrow' ? this.arrowMask() : 0);
      }
    }
    if (cfg.scoreBy === 'crates') {
      this.crateTimer -= dt;
      if (this.crateTimer <= 0) {
        this.crateTimer = this.nextIn(cfg.crateEvery, cfg.crateVariance);
        const cap = Math.max(MAX_CRATES, 2 * cfg.crateCount);
        let crates = this.items.filter((i) => i.k === 'crate').length;
        for (let n = 0; n < cfg.crateCount && crates < cap; n++, crates++) if (!this.spawn('crate')) break;
      }
    }
  }

  private stepPadlock(dt: number): void {
    const lock = this.items.find((i) => i.k === 'padlock');
    if (!lock) {
      this.padlockCd -= dt;
      if (this.padlockCd <= 0) {
        this.spawn('padlock');
        this.padlockStep = PADLOCK_STEP;
      }
      return;
    }
    this.padlockStep -= dt;
    if (this.padlockStep > 0) return;
    this.padlockStep = PADLOCK_STEP;
    const d = Math.floor(this.rng() * 4);
    const c = lock.c + DX[d];
    const r = lock.r + DY[d];
    if (c < 0 || r < 0 || c >= this.n || r >= this.n || this.itemAt(c, r)) return;
    lock.c = c;
    lock.r = r;
  }

  /** Blast Bot circles just outside the grid; its position as tile units + side. */
  private bomberPos(): { x: number; y: number; side: number; along: number } {
    const n = this.n;
    const u = ((this.bomberU % (4 * n)) + 4 * n) % (4 * n);
    const side = Math.floor(u / n);
    const s = u - side * n;
    const o = BOMBER_OFFSET;
    switch (side) {
      case 0:
        return { x: s + 0.5, y: -o, side, along: s };
      case 1:
        return { x: n + o, y: s + 0.5, side, along: s };
      case 2:
        return { x: n - s - 0.5, y: n + o, side, along: n - 1 - s };
      default:
        return { x: -o, y: n - s - 0.5, side, along: n - 1 - s };
    }
  }

  private stepBomber(dt: number): void {
    this.bomberU += BOMBER_SPEED * dt;
    this.rooTimer -= dt;
    if (this.rooTimer > 0) return;
    this.rooTimer = this.nextIn(this.cfg.tntEvery, this.cfg.tntVariance);
    const action = this.bomberStep++ % 3;
    if (action === 0) {
      this.spawn('tnt', this.cfg.tntFuse);
    } else if (action === 1) {
      const { side, along } = this.bomberPos();
      const a = Math.max(0, Math.min(this.n - 1, Math.floor(along))) + 0.5;
      const e = 0.01;
      const dir = (side + 2) % 4; // pointing into the grid
      const start = [
        { x: a, y: e },
        { x: this.n - e, y: a },
        { x: a, y: this.n - e },
        { x: e, y: a },
      ][side];
      this.missiles.push({ id: this.nextId++, x: start.x, y: start.y, dir, owner: -1 });
    } else {
      this.spawn('arrow', Infinity, 15); // 4-way arrow square
    }
  }

  // ---- Minigame output ----------------------------------------------------
  getState(): PogoState {
    const players: PogoPlayerState[] = this.players.map((p) => ({
      id: p.id,
      c: p.c,
      r: p.r,
      pc: p.pc,
      pr: p.pr,
      hop: p.hopping ? r2(Math.min(1, p.hopT / p.hopDur)) : 1,
      f: p.facing,
      score: p.score,
      tiles: this.countTiles(p.idx),
      item: p.item,
      boots: r2(Math.min(1, p.bootsT / BOOTS_TIME)),
      lock: r2(Math.min(1, p.lockT / this.cfg.padlockTime)),
      stun: p.stunT > 0,
      inv: p.invulnT > 0,
      gone: p.gone,
    }));
    const state: PogoState = {
      kind: 'ext:spring-showdown',
      variant: this.cfg.variant,
      t: r1(this.t),
      limit: this.cfg.timeLimit,
      size: this.n,
      solid: this.cfg.collisions,
      tiles: this.tiles.slice(),
      players,
      items: this.items.map((i) => (i.k === 'tnt' ? { id: i.id, c: i.c, r: i.r, k: i.k, d: i.d, f: r1(Math.max(0, i.ttl)) } : { id: i.id, c: i.c, r: i.r, k: i.k, d: i.d })),
      missiles: this.missiles.map((m) => ({ id: m.id, x: r2(m.x), y: r2(m.y), dir: m.dir })),
    };
    if (this.beams.length > 0) state.beams = this.beams.map((b) => ({ c: b.c, r: b.r, d: b.dir, f: r2(b.t / BEAM_TIME) }));
    if (this.cfg.bomber) {
      const { x, y } = this.bomberPos();
      state.boss = { x: r2(x), y: r2(y) };
      state.blast = this.cfg.tntRadius;
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
    // banked points first, painted (unbanked) tiles break ties
    const ranked = this.players
      // leavers rank below everyone connected (the later they left, the higher), whatever they banked
      .map((p) => ({ id: p.id, key: p.left > 0 ? p.left - 1e9 : p.score * 10000 + this.countTiles(p.idx) }))
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
