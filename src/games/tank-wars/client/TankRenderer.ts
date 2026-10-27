import type Phaser from 'phaser';
import type { GameState } from '../../../core/shared/types';
import type { ClientContext, RenderHost } from '../../../core/client/src/plugins/api';
import {
  TANK_BLOCKS,
  TANK_CENTRE,
  TANK_MAX,
  TANK_MIN,
  TANK_SQUARE,
  arenaBounds,
  TANK_METAL_WALLS,
  TANK_R,
  TANK_RAILS,
  TANK_RAIL_BLOCKS,
  TANK_RAIL_METAL_WALLS,
  RAIL_MIN,
  RAIL_MAX,
  TANK_TOTEM_HALF,
  TANK_TOTEM_POST,
  TANK_TOTEM_LEN,
} from '../shared/geometry';
import type { TankPlayerState, TankState } from '../shared/types';

const FALL_MS = 700;
const TELEPORT = 300;

type Scenery = { floor: number; floorAlt: number; edge: number; block: number };
const SCENERY: Record<string, Scenery> = {
  'desert-fox': { floor: 0xc9a766, floorAlt: 0xbf9b5a, edge: 0x7a5a2a, block: 0x9a6a36 },
  'metal-fox': { floor: 0x6f7686, floorAlt: 0x646b7a, edge: 0x3a3f4a, block: 0x4c5260 },
  'jungle-fox': { floor: 0x4f7a3a, floorAlt: 0x5a8844, edge: 0x2c4a22, block: 0x3a5a2a },
  'swamp-fox': { floor: 0x35603a, floorAlt: 0x2e5535, edge: 0x1c3a22, block: 0x244a2c },
};
const CANNON_COLORS = [0xffd23f, 0x7bff7b, 0xd9d9d9, 0xff7a1a];

/** Draws Tank Wars: the arena, walls, mines, shots and the tanks (rotor boats in Swamp Fox). */
export class TankRenderer {
  constructor(private readonly ctx: ClientContext) {}

  private fallenAt = new Map<string, number>();

  reset(): void {
    this.fallenAt.clear();
  }

  markFallen(id: string): void {
    this.fallenAt.set(id, performance.now());
  }

  render(host: RenderHost, as: GameState, bs: GameState, latestState: GameState, alpha: number): void {
    const [a, b, latest] = [as, bs, latestState] as TankState[];
    const g = host.g;
    const sc = SCENERY[latest.variant] ?? SCENERY['desert-fox'];
    this.drawArena(g, latest, sc);

    for (const k of latest.pickups) this.drawPickup(g, k);
    for (const m of latest.mines) this.drawMine(g, m.x, m.y, m.fuse);
    for (const bl of latest.blasts) this.drawBlast(g, bl);
    for (const bm of latest.bombs) {
      const lift = Math.sin(Math.PI * bm.h) * 60;
      g.fillStyle(0x000000, 0.3).fillEllipse(bm.x, bm.y + 6, 22, 10);
      g.fillStyle(0x2b2b2b, 1).fillCircle(bm.x, bm.y - lift, 11);
      g.fillStyle(0xff3b3b, 1).fillCircle(bm.x + 4, bm.y - lift - 10, 3);
    }
    for (const s of latest.shots) this.drawShot(g, s);

    const aById = new Map(a.players.map((p) => [p.id, p]));
    const bById = new Map(b.players.map((p) => [p.id, p]));
    const now = performance.now();
    for (const p of latest.players) {
      const pa = aById.get(p.id) ?? p;
      const pb = bById.get(p.id) ?? p;
      const jumped = Math.hypot(pb.x - pa.x, pb.y - pa.y) > TELEPORT;
      const x = jumped ? pb.x : this.ctx.lerp(pa.x, pb.x, alpha);
      const y = jumped ? pb.y : this.ctx.lerp(pa.y, pb.y, alpha);
      this.drawTank(host, p, x, y, latest, now);
    }
    if (latest.totem && latest.totem.hit > 0) {
      g.fillStyle(0xffffff, 0.5 * latest.totem.hit).fillCircle(TANK_CENTRE, TANK_CENTRE, 150);
    }
  }

  private drawArena(g: Phaser.GameObjects.Graphics, s: TankState, sc: Scenery): void {
    const { min, max } = arenaBounds(s.size);
    const size = max - min;
    g.fillStyle(sc.edge, 1).fillRect(min - 16, min - 16, size + 32, size + 32);
    g.fillStyle(sc.floor, 1).fillRect(min, min, size, size);
    g.fillStyle(sc.floorAlt, 1);
    const cell = TANK_SQUARE;
    for (let y = 0; y < size / cell; y++) {
      for (let x = 0; x < size / cell; x++) {
        if ((x + y) % 2 === 0) g.fillRect(min + x * cell, min + y * cell, cell, cell);
      }
    }
    if (s.rails) {
      // the rails: a dark track with lighter sleepers, and a bolt at every crossing
      for (const v of TANK_RAILS) {
        g.lineStyle(10, sc.edge, 0.55).lineBetween(RAIL_MIN, v, RAIL_MAX, v).lineBetween(v, RAIL_MIN, v, RAIL_MAX);
      }
      g.lineStyle(3, 0xffffff, 0.22);
      for (const v of TANK_RAILS) {
        for (let k = RAIL_MIN; k <= RAIL_MAX; k += 28) {
          g.lineBetween(k, v - 9, k, v + 9).lineBetween(v - 9, k, v + 9, k);
        }
      }
      for (const vx of TANK_RAILS) for (const vy of TANK_RAILS) g.fillStyle(sc.edge, 0.9).fillCircle(vx, vy, 7);
    }
    if (s.variant === 'swamp-fox') {
      // puddles are laid out for the whole arena and shrink towards the centre with a smaller field
      const k = size / (TANK_MAX - TANK_MIN);
      g.fillStyle(0x2a7a8a, 0.35);
      for (const [cx, cy] of [
        [250, 260],
        [740, 330],
        [420, 720],
        [800, 780],
      ]) g.fillEllipse(TANK_CENTRE + (cx - TANK_CENTRE) * k, TANK_CENTRE + (cy - TANK_CENTRE) * k, 190 * k, 120 * k);
    }

    if (s.variant === 'desert-fox' || s.variant === 'metal-fox') {
      for (const r of s.rails ? TANK_RAIL_BLOCKS : TANK_BLOCKS) {
        g.fillStyle(0x000000, 0.3).fillRect(r.x + 6, r.y + 10, r.w, r.h);
        g.fillStyle(sc.block, 1).fillRect(r.x, r.y, r.w, r.h);
        g.fillStyle(0xffffff, 0.12).fillRect(r.x, r.y, r.w, 14);
        g.lineStyle(3, sc.edge, 1).strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    if (s.walls) {
      const now = performance.now();
      (s.rails ? TANK_RAIL_METAL_WALLS : TANK_METAL_WALLS).forEach((w, i) => {
        const up = s.walls!.raised[i];
        const pulse = s.walls!.warn ? 0.5 + 0.5 * Math.sin(now / 60) : 1;
        if (up) {
          g.fillStyle(0xc7ccd6, s.walls!.warn ? 0.55 + 0.4 * pulse : 1).fillRect(w.x, w.y, w.w, w.h);
          g.lineStyle(3, 0x2b2f38, 1).strokeRect(w.x, w.y, w.w, w.h);
        } else {
          g.fillStyle(0x2b2f38, 0.5).fillRect(w.x, w.y, w.w, w.h);
        }
      });
    }

    if (s.totem) {
      if (s.totem.warn > 0) {
        const c = Math.cos(s.totem.a);
        const sn = Math.sin(s.totem.a);
        const pts = [
          [0, -TANK_TOTEM_HALF],
          [TANK_TOTEM_LEN, -TANK_TOTEM_HALF],
          [TANK_TOTEM_LEN, TANK_TOTEM_HALF],
          [0, TANK_TOTEM_HALF],
        ].map(([lx, ly]) => ({ x: TANK_CENTRE + lx * c - ly * sn, y: TANK_CENTRE + lx * sn + ly * c }));
        g.fillStyle(0xff3b3b, 0.25 + 0.35 * (1 - s.totem.warn)).fillPoints(pts, true);
        g.lineStyle(4, 0xff3b3b, 0.9).strokePoints(pts, true);
      }
      // the post goes on top of the warning, which starts under it
      const post = TANK_TOTEM_POST;
      const inner = post.w * 0.64;
      g.fillStyle(0x000000, 0.25).fillRect(post.x + 6, post.y + 9, post.w, post.h);
      g.fillStyle(0x7a5232, 1).fillRect(post.x, post.y, post.w, post.h);
      g.lineStyle(5, 0x4a321e, 1).strokeRect(post.x, post.y, post.w, post.h);
      g.fillStyle(0xe0a96d, 1).fillRect(TANK_CENTRE - inner / 2, TANK_CENTRE - inner / 2, inner, inner);
    }
  }

  private drawPickup(g: Phaser.GameObjects.Graphics, k: TankState['pickups'][number]): void {
    const fall = k.land * 120;
    const bob = Math.sin(performance.now() / 200 + k.id) * 3;
    g.fillStyle(0x000000, 0.25).fillEllipse(k.x + 2, k.y + 10, 24, 10);
    const y = k.y - fall + bob;
    if (k.k === 'fruit') {
      g.fillStyle(0xff8a1a, 1).fillCircle(k.x, y, 12);
      g.fillStyle(0x4aa83a, 1).fillCircle(k.x + 5, y - 11, 5);
    } else if (k.k === 'mine') {
      g.fillStyle(0x2b2b2b, 1).fillCircle(k.x, y, 12);
      g.fillStyle(0xffd23f, 1).fillCircle(k.x, y, 5);
    } else if (k.k === 'bomb') {
      g.fillStyle(0x2b2b2b, 1).fillCircle(k.x, y, 13);
      g.fillStyle(0xff3b3b, 1).fillRect(k.x - 2, y - 20, 4, 8);
    } else {
      g.fillStyle(0xdddddd, 1).fillRoundedRect(k.x - 16, y - 7, 32, 14, 6);
      g.fillStyle(0xff3b3b, 1).fillTriangle(k.x + 16, y - 7, k.x + 28, y, k.x + 16, y + 7);
    }
  }

  private drawMine(g: Phaser.GameObjects.Graphics, x: number, y: number, fuse: number): void {
    const blink = fuse >= 0 && fuse < 0.35 ? 0.5 + 0.5 * Math.sin(performance.now() / 50) : 1;
    g.fillStyle(0x000000, 0.3).fillEllipse(x + 2, y + 6, 28, 12);
    g.fillStyle(0x2b2b2b, 1).fillCircle(x, y, 13);
    g.lineStyle(2, 0x7a7a7a, 1).strokeCircle(x, y, 13);
    g.fillStyle(fuse < 0 ? 0x7bff7b : 0xff3b3b, blink).fillCircle(x, y, 5);
  }

  private drawBlast(g: Phaser.GameObjects.Graphics, b: TankState['blasts'][number]): void {
    const a = Math.max(0, b.life);
    if (b.rays) {
      const dirs = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ];
      dirs.forEach(([dx, dy], i) => {
        const len = b.rays![i];
        if (len <= 0) return;
        const w = 22;
        const x0 = b.x + Math.min(0, dx * len) - (dy !== 0 ? w : 0);
        const y0 = b.y + Math.min(0, dy * len) - (dx !== 0 ? w : 0);
        const ww = dx !== 0 ? len : w * 2;
        const hh = dy !== 0 ? len : w * 2;
        g.fillStyle(0xff7a1a, 0.75 * a).fillRect(x0, y0, ww, hh);
        g.fillStyle(0xffd23f, 0.6 * a).fillRect(dx !== 0 ? x0 : x0 + w * 0.5, dy !== 0 ? y0 : y0 + w * 0.5, dx !== 0 ? ww : w, dy !== 0 ? hh : w);
      });
      g.fillStyle(0xffd23f, 0.9 * a).fillCircle(b.x, b.y, b.r);
    } else {
      g.fillStyle(0xff7a1a, 0.55 * a).fillCircle(b.x, b.y, b.r * (1.1 - 0.3 * a));
      g.fillStyle(0xffd23f, 0.7 * a).fillCircle(b.x, b.y, b.r * 0.6 * a);
    }
  }

  private drawShot(g: Phaser.GameObjects.Graphics, s: TankState['shots'][number]): void {
    if (s.k === 'rocket') {
      const c = Math.cos(s.f);
      const sn = Math.sin(s.f);
      g.fillStyle(0xdddddd, 1).fillCircle(s.x, s.y, 7);
      g.fillStyle(0xff3b3b, 1).fillCircle(s.x + c * 8, s.y + sn * 8, 5);
      g.fillStyle(0xffd23f, 0.8).fillCircle(s.x - c * 10, s.y - sn * 10, 5);
      return;
    }
    const col = CANNON_COLORS[s.c % CANNON_COLORS.length];
    g.fillStyle(col, 1).fillCircle(s.x, s.y, s.c === 2 ? 11 : 7);
    g.lineStyle(2, 0x1b1033, 0.8).strokeCircle(s.x, s.y, s.c === 2 ? 11 : 7);
  }

  private drawTank(host: RenderHost, p: TankPlayerState, x: number, y: number, s: TankState, now: number): void {
    const g = host.g;
    const color = this.ctx.colorOf(p.id);
    let scale = 1;
    if (!p.alive) {
      const t0 = this.fallenAt.get(p.id) ?? now;
      if (!this.fallenAt.has(p.id)) this.fallenAt.set(p.id, now);
      const k = (now - t0) / FALL_MS;
      if (k >= 1) {
        host.label(p.id).setVisible(false);
        return;
      }
      scale = 1 - k;
    }
    const r = TANK_R * scale;
    const isMe = p.id === this.ctx.myId();
    const boat = s.variant === 'swamp-fox';
    const c = Math.cos(p.f);
    const sn = Math.sin(p.f);
    const pt = (lx: number, ly: number) => ({ x: x + lx * c - ly * sn, y: y + lx * sn + ly * c });

    g.fillStyle(0x000000, 0.3).fillEllipse(x + 4, y + 8 * scale, r * 2.4, r * 1.6);
    // hull
    const corners = [pt(-r * 1.1, -r * 0.95), pt(r * 1.1, -r * 0.95), pt(r * 1.1, r * 0.95), pt(-r * 1.1, r * 0.95)];
    if (boat) {
      g.fillStyle(0xdde4f0, 1).fillEllipse(x, y, r * 2.6, r * 1.9);
      g.lineStyle(3, 0x1b1033, 0.8).strokeEllipse(x, y, r * 2.6, r * 1.9);
    } else {
      g.fillStyle(0x3a3f4a, 1).fillPoints(corners, true);
      g.lineStyle(3, 0x1b1033, 0.8).strokePoints(corners, true);
      // tracks
      for (const side of [-1, 1]) {
        const a0 = pt(-r * 1.1, side * r * 0.95);
        const a1 = pt(r * 1.1, side * r * 0.95);
        g.lineStyle(6, 0x1b1033, 0.9).lineBetween(a0.x, a0.y, a1.x, a1.y);
      }
    }
    // cannon barrel in the colour of its shots
    const muzzle = pt(r * 1.9, 0);
    const base = pt(0, 0);
    g.lineStyle(8, CANNON_COLORS[p.cannon % CANNON_COLORS.length], 1).lineBetween(base.x, base.y, muzzle.x, muzzle.y);
    if (!(p.inv && Math.floor(now / 80) % 2 === 0)) {
      g.fillStyle(color, 1).fillCircle(x, y, r * 0.95);
      this.ctx.drawCharacter(g, p.id, x, y, r * 0.75, p.f);
    }

    if (p.up) {
      g.lineStyle(5, 0x7fd8ff, 0.5 + 0.4 * Math.sin(now / 80)).strokeCircle(x, y, r + 12);
      g.fillStyle(0x7fd8ff, 0.2).fillCircle(x, y, r + 12);
    }
    if (p.item) {
      const col = p.item === 'bomb' ? 0x2b2b2b : 0xff3b3b;
      g.fillStyle(col, 1).fillCircle(x + r + 10, y - r - 4, 7);
      g.lineStyle(2, 0xffffff, 0.9).strokeCircle(x + r + 10, y - r - 4, 7);
    }
    if (p.alive) {
      // health bar above the tank
      const w = 44;
      const frac = Math.max(0, Math.min(1, p.hp / s.maxHp));
      g.fillStyle(0x000000, 0.55).fillRect(x - w / 2 - 1, y - r - 24, w + 2, 8);
      g.fillStyle(frac > 0.5 ? 0x7bff7b : frac > 0.25 ? 0xffd23f : 0xff3b3b, 1).fillRect(x - w / 2, y - r - 23, w * frac, 6);
    }
    host.label(p.id).setPosition(x, y - r - 28).setAlpha(scale).setVisible(true);
  }
}
