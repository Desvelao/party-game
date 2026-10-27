import type Phaser from 'phaser';
import type { ClientContext, RenderHost } from '../../../core/client/src/plugins/api';
import { POGO_BOARD } from '../shared/geometry';
import type { PogoItemKind, PogoPlayerState, PogoState } from '../shared/types';
import { BOOTS_SOUNDS, MISSILE_SOUNDS, bootsSound, missileSounds, type MissilePos } from './sounds';

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** Draws the Spring Showdown family: the tile board, hoppers, items, missiles and Blast Bot. */
export class PogoRenderer {
  /** fuse labels used this frame / last frame (the unused ones are hidden), and the last beeped second per TNT */
  private fuseLabels = new Set<string>();
  private prevFuseLabels = new Set<string>();
  private beeped = new Map<string, number>();
  private prevMissiles = new Map<number, MissilePos>();
  private seen = false;
  private bootsOf = '';
  private prevBoots = 0;
  private bootsAt = 0;

  constructor(private readonly ctx: ClientContext) {}

  render(host: RenderHost, a: PogoState, b: PogoState, latest: PogoState, alpha: number): void {
    const g = host.g;
    const n = latest.size;
    const cell = POGO_BOARD.size / n;
    const bx = POGO_BOARD.x;
    const by = POGO_BOARD.y;
    const now = performance.now();

    // ---- tiles
    g.fillStyle(0x000000, 0.35).fillRoundedRect(bx - 6, by - 4, POGO_BOARD.size + 18, POGO_BOARD.size + 20, 14);
    g.fillStyle(0x2c1b52, 1).fillRoundedRect(bx - 10, by - 10, POGO_BOARD.size + 20, POGO_BOARD.size + 20, 14);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const owner = latest.tiles[r * n + c];
        const x = bx + c * cell;
        const y = by + r * cell;
        const base = (r + c) % 2 === 0 ? 0x3d2a73 : 0x4a3489;
        g.fillStyle(base, 1).fillRect(x + 1, y + 1, cell - 2, cell - 2);
        if (owner >= 0 && latest.players[owner]) {
          const pl = latest.players[owner];
          const color = this.ctx.colorOf(pl.id);
          g.fillStyle(color, 0.92).fillRoundedRect(x + 3, y + 3, cell - 6, cell - 6, 8);
          if (pl.lock > 0) {
            const pulse = 0.5 + 0.5 * Math.sin(now / 120);
            g.lineStyle(4, 0xffffff, 0.5 + 0.4 * pulse).strokeRoundedRect(x + 4, y + 4, cell - 8, cell - 8, 8);
          }
        }
      }
    }

    // ---- items
    const bob = Math.sin(now / 240) * 3;
    this.fuseLabels = new Set();
    for (const k of missileSounds(this.prevMissiles, latest.missiles, n, !this.seen)) this.ctx.sound(MISSILE_SOUNDS[k]);
    this.seen = true;
    this.playBoots(latest);
    for (const it of latest.items) {
      const cx = bx + (it.c + 0.5) * cell;
      const cy = by + (it.r + 0.5) * cell + (it.k === 'mushroom' || it.k === 'tnt' ? 0 : bob);
      if (it.k === 'tnt' && it.f !== undefined) this.drawFuse(g, it.c, it.r, it.f, latest.blast ?? 1, n, bx, by, cell, now);
      this.drawItem(g, it.k, it.d, cx, cy, cell * 0.36);
      if (it.k === 'tnt' && it.f !== undefined) this.drawCountdown(host, `fuse:${it.id}`, cx, cy, cell * 0.36, it.f);
    }
    // countdowns of TNT that are gone (stepped on, exploded) disappear
    for (const id of this.prevFuseLabels) {
      if (this.fuseLabels.has(id)) continue;
      host.label(id).setVisible(false);
      this.beeped.delete(id);
    }
    this.prevFuseLabels = this.fuseLabels;

    // ---- boss
    if (latest.boss) this.drawBomber(g, bx + latest.boss.x * cell, by + latest.boss.y * cell, cell);

    // ---- players (interpolated positions along their hop arc)
    const aBy = new Map(a.players.map((p) => [p.id, p]));
    const bBy = new Map(b.players.map((p) => [p.id, p]));
    for (const p of latest.players) {
      if (p.gone) {
        host.label(p.id).setVisible(false);
        continue;
      }
      const pa = this.hopPos(aBy.get(p.id) ?? p);
      const pb = this.hopPos(bBy.get(p.id) ?? p);
      const px = this.ctx.lerp(pa.x, pb.x, alpha);
      const py = this.ctx.lerp(pa.y, pb.y, alpha);
      const lift = this.ctx.lerp(pa.lift, pb.lift, alpha);
      this.drawHopper(host, p, bx + (px + 0.5) * cell, by + (py + 0.5) * cell, lift * cell, cell, now);
    }

    // ---- missiles
    for (const m of latest.missiles) {
      const x = bx + m.x * cell;
      const y = by + m.y * cell;
      const dx = DX[m.dir];
      const dy = DY[m.dir];
      g.lineStyle(10, 0xff9a3c, 0.5).lineBetween(x - dx * 26, y - dy * 26, x, y);
      g.fillStyle(0xffffff, 1).fillCircle(x, y, 9);
      g.fillStyle(0xff3b3b, 1).fillCircle(x + dx * 5, y + dy * 5, 6);
    }

    // ---- Zap Beams: a jagged bolt from the shooter to the board edge
    for (const bm of latest.beams ?? []) this.drawBeam(g, bm, n, cell, bx, by, now);

    this.drawScores(host, latest);
  }

  private drawBeam(g: RenderHost['g'], bm: NonNullable<PogoState['beams']>[number], n: number, cell: number, bx: number, by: number, now: number): void {
    const dx = DX[bm.d];
    const dy = DY[bm.d];
    const x0 = bx + (bm.c + 0.5) * cell;
    const y0 = by + (bm.r + 0.5) * cell;
    const len = (dx > 0 ? n - bm.c - 0.5 : dx < 0 ? bm.c + 0.5 : dy > 0 ? n - bm.r - 0.5 : bm.r + 0.5) * cell;
    const steps = Math.max(2, Math.round(len / (cell * 0.35)));
    const jitter = cell * 0.16;
    const seed = Math.floor(now / 50);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const off = i === 0 ? 0 : (Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453 % 1) * jitter;
      pts.push({ x: x0 + dx * (len * i) / steps - dy * off, y: y0 + dy * (len * i) / steps + dx * off });
    }
    const a = Math.min(1, bm.f * 1.6);
    g.lineStyle(cell * 0.34, 0x4aa8ff, 0.3 * a).strokePoints(pts, false);
    g.lineStyle(cell * 0.14, 0x9fd4ff, 0.8 * a).strokePoints(pts, false);
    g.lineStyle(cell * 0.05, 0xffffff, a).strokePoints(pts, false);
  }

  /** Fractional tile position + hop lift (0..1 of a cell) for a player snapshot. */
  private hopPos(p: PogoPlayerState): { x: number; y: number; lift: number } {
    const k = p.hop;
    return {
      x: p.pc + (p.c - p.pc) * k,
      y: p.pr + (p.r - p.pr) * k,
      lift: k >= 1 ? 0 : Math.sin(Math.PI * k) * 0.55,
    };
  }

  private drawHopper(host: RenderHost, p: PogoPlayerState, x: number, y: number, lift: number, cell: number, now: number): void {
    const g = host.g;
    const r = cell * 0.3;
    g.fillStyle(0x000000, 0.3).fillEllipse(x + 3, y + r * 0.9, r * 1.8 * (1 - lift * 0.4), r * 0.8);
    const by = y - lift;
    // pogo stick + spring
    g.lineStyle(5, 0xdddddd, 1).lineBetween(x, by + r * 0.4, x, y + r * 0.8);
    g.lineStyle(3, 0xaaaaaa, 1);
    for (let i = 0; i < 3; i++) g.lineBetween(x - 7, y + r * 0.5 + i * 5, x + 7, y + r * 0.5 + i * 5 + 3);
    if (!(p.inv && Math.floor(now / 80) % 2 === 0)) this.ctx.drawCharacter(g, p.id, x, by - r * 0.3, r, Math.atan2(DY[p.f], DX[p.f]));
    if (p.boots > 0) g.lineStyle(4, 0xffd23f, 0.9).strokeCircle(x, by - r * 0.3, r + 6);
    if (p.lock > 0) g.lineStyle(4, 0xffffff, 0.9).strokeCircle(x, by - r * 0.3, r + 11);
    if (p.item) this.drawItem(g, p.item, 0, x + r * 1.1, by - r * 1.3, cell * 0.17);
    if (p.stun) {
      for (let i = 0; i < 3; i++) {
        const a = now / 180 + (i * Math.PI * 2) / 3;
        g.fillStyle(0xffd23f, 1).fillCircle(x + Math.cos(a) * r * 0.9, by - r * 1.5 + Math.sin(a) * 5, 4);
      }
    }
    host.label(p.id).setPosition(x, by - r * 1.5 - (p.item ? 8 : 0)).setVisible(true).setAlpha(1);
  }

  private drawItem(g: Phaser.GameObjects.Graphics, k: PogoItemKind, d: number, x: number, y: number, s: number): void {
    g.fillStyle(0x000000, 0.25).fillEllipse(x + 2, y + s * 1.05, s * 1.8, s * 0.6);
    switch (k) {
      case 'crate':
        g.fillStyle(0x8a3fd6, 1).fillRoundedRect(x - s, y - s, s * 2, s * 2, 6);
        g.lineStyle(4, 0xe9d0ff, 1).strokeRoundedRect(x - s, y - s, s * 2, s * 2, 6);
        g.fillStyle(0xffffff, 1).fillRect(x - s * 0.14, y - s * 0.6, s * 0.28, s * 0.75).fillCircle(x, y + s * 0.55, s * 0.17);
        break;
      case 'boots':
        g.fillStyle(0xffd23f, 1).fillRoundedRect(x - s * 0.9, y - s * 0.2, s * 1.8, s * 0.9, 5);
        g.fillStyle(0xffd23f, 1).fillRect(x - s * 0.9, y - s * 0.9, s * 0.8, s * 0.8);
        g.fillStyle(0xffffff, 1).fillRect(x - s * 0.9, y + s * 0.5, s * 1.8, s * 0.22);
        g.lineStyle(3, 0x1b1033, 1).strokeRoundedRect(x - s * 0.9, y - s * 0.2, s * 1.8, s * 0.9, 5);
        break;
      case 'missile':
        g.fillStyle(0xffffff, 1).fillRoundedRect(x - s * 0.9, y - s * 0.35, s * 1.5, s * 0.7, 6);
        g.fillStyle(0xff3b3b, 1).fillTriangle(x + s * 0.6, y - s * 0.35, x + s * 1.1, y, x + s * 0.6, y + s * 0.35);
        g.fillStyle(0xff3b3b, 1).fillTriangle(x - s * 0.9, y - s * 0.35, x - s * 1.1, y - s * 0.8, x - s * 0.4, y - s * 0.35);
        g.fillStyle(0xff3b3b, 1).fillTriangle(x - s * 0.9, y + s * 0.35, x - s * 1.1, y + s * 0.8, x - s * 0.4, y + s * 0.35);
        break;
      case 'beam':
        g.fillStyle(0x4aa8ff, 1).fillCircle(x, y, s);
        g.fillStyle(0xfff08a, 1).fillPoints(
          [
            { x: x + s * 0.2, y: y - s * 0.85 },
            { x: x - s * 0.5, y: y + s * 0.1 },
            { x: x - s * 0.05, y: y + s * 0.1 },
            { x: x - s * 0.25, y: y + s * 0.85 },
            { x: x + s * 0.5, y: y - s * 0.15 },
            { x: x + s * 0.05, y: y - s * 0.15 },
          ],
          true,
        );
        break;
      case 'arrow': {
        g.fillStyle(0x1b1033, 0.65).fillRoundedRect(x - s, y - s, s * 2, s * 2, 6);
        for (let dir = 0; dir < 4; dir++) {
          if (!(d & (1 << dir))) continue;
          const dx = DX[dir];
          const dy = DY[dir];
          const px = -dy;
          const py = dx;
          g.fillStyle(0x7bff7b, 1).fillTriangle(
            x + dx * s * 0.9, y + dy * s * 0.9,
            x + dx * s * 0.3 + px * s * 0.5, y + dy * s * 0.3 + py * s * 0.5,
            x + dx * s * 0.3 - px * s * 0.5, y + dy * s * 0.3 - py * s * 0.5,
          );
          g.lineStyle(5, 0x7bff7b, 1).lineBetween(x, y, x + dx * s * 0.4, y + dy * s * 0.4);
        }
        break;
      }
      case 'mushroom':
        g.fillStyle(0xf3e9d2, 1).fillRect(x - s * 0.25, y, s * 0.5, s * 0.9);
        g.fillStyle(0xd62b4a, 1).fillEllipse(x, y - s * 0.1, s * 2, s * 1.3);
        g.fillStyle(0xffffff, 1).fillCircle(x - s * 0.4, y - s * 0.2, s * 0.17).fillCircle(x + s * 0.35, y - s * 0.3, s * 0.14);
        g.lineStyle(3, 0x4b0f66, 0.9).strokeEllipse(x, y - s * 0.1, s * 2, s * 1.3);
        break;
      case 'tnt':
        g.fillStyle(0xd62b2b, 1).fillRoundedRect(x - s * 0.9, y - s * 0.7, s * 1.8, s * 1.4, 4);
        g.fillStyle(0xffffff, 1).fillRect(x - s * 0.9, y - s * 0.15, s * 1.8, s * 0.3);
        g.lineStyle(3, 0x444444, 1).lineBetween(x, y - s * 0.7, x + s * 0.3, y - s * 1.1);
        g.fillStyle(0xffd23f, 1).fillCircle(x + s * 0.32, y - s * 1.15, 5);
        break;
      case 'padlock':
        g.lineStyle(6, 0xdddddd, 1).strokeCircle(x, y - s * 0.4, s * 0.55);
        g.fillStyle(0xffd23f, 1).fillRoundedRect(x - s * 0.8, y - s * 0.2, s * 1.6, s * 1.2, 5);
        g.fillStyle(0x1b1033, 1).fillCircle(x, y + s * 0.3, s * 0.2);
        break;
    }
  }

  /** the blast zone of a lit TNT, pulsing faster as the fuse runs out */
  private drawFuse(g: Phaser.GameObjects.Graphics, c: number, r: number, fuse: number, blast: number, n: number, bx: number, by: number, cell: number, now: number): void {
    const c0 = Math.max(0, c - blast);
    const r0 = Math.max(0, r - blast);
    const c1 = Math.min(n - 1, c + blast);
    const r1 = Math.min(n - 1, r + blast);
    const urgency = 1 - Math.min(fuse, 3) / 3;
    const pulse = 0.5 + 0.5 * Math.sin(now / (70 + 60 * (1 - urgency) * 3));
    g.fillStyle(0xff3b1a, 0.12 + 0.28 * pulse * (0.4 + 0.6 * urgency)).fillRect(bx + c0 * cell + 2, by + r0 * cell + 2, (c1 - c0 + 1) * cell - 4, (r1 - r0 + 1) * cell - 4);
  }

  /** the boots sound of the player we follow: ours, else the first boosted one (a shared screen), never several at once */
  private playBoots(s: PogoState): void {
    const mine = s.players.find((p) => p.id === this.ctx.myId());
    const p = mine ?? s.players.find((q) => q.boots > 0) ?? (this.prevBoots > 0 ? s.players.find((q) => q.id === this.bootsOf) : undefined);
    const now = performance.now();
    if (!p) {
      this.prevBoots = 0;
      return;
    }
    if (p.id !== this.bootsOf) {
      this.bootsOf = p.id;
      this.prevBoots = p.boots;
      this.bootsAt = now;
    }
    const k = bootsSound(this.prevBoots, p.boots, now, this.bootsAt);
    this.prevBoots = p.boots;
    if (!k) return;
    if (k !== 'end') this.bootsAt = now;
    this.ctx.sound(BOOTS_SOUNDS[k]);
  }

  /** the seconds left on a TNT, on a dark badge so the digit reads on the red crate; a tick per second */
  private drawCountdown(host: RenderHost, id: string, x: number, y: number, s: number, fuse: number): void {
    const n = Math.max(1, Math.ceil(fuse - 1e-6));
    this.fuseLabels.add(id);
    if (this.beeped.get(id) !== n) {
      this.beeped.set(id, n);
      this.ctx.sfx(n <= 1 ? 'hazard' : 'tick');
    }
    host.g.fillStyle(0x1b1033, 0.9).fillCircle(x, y, s * 0.95);
    host.g.lineStyle(2, n <= 1 ? 0xff5a4a : 0xffffff, 0.9).strokeCircle(x, y, s * 0.95);
    host
      .label(id)
      .setText(String(n))
      .setFontSize(Math.max(14, Math.round(s * 1.5)))
      .setColor(n <= 1 ? '#ff5a4a' : n === 2 ? '#ffd23f' : '#ffffff')
      .setStroke('#1b1033', Math.max(3, Math.round(s * 0.2)))
      .setPosition(x, y)
      .setOrigin(0.5)
      .setAlpha(1)
      .setVisible(true);
  }

  private drawBomber(g: Phaser.GameObjects.Graphics, x: number, y: number, cell: number): void {
    const s = cell * 0.42;
    g.fillStyle(0x000000, 0.25).fillEllipse(x + 4, y + s, s * 2, s * 0.7);
    g.fillStyle(0x6b7a8f, 1).fillCircle(x, y, s);
    g.lineStyle(4, 0x1b1033, 1).strokeCircle(x, y, s);
    g.fillStyle(0xffffff, 1).fillCircle(x - s * 0.35, y - s * 0.15, s * 0.28).fillCircle(x + s * 0.35, y - s * 0.15, s * 0.28);
    g.fillStyle(0x111111, 1).fillCircle(x - s * 0.35, y - s * 0.15, s * 0.12).fillCircle(x + s * 0.35, y - s * 0.15, s * 0.12);
    g.fillStyle(0x3a4658, 1).fillTriangle(x - s * 0.9, y - s * 0.4, x - s * 0.5, y - s * 1.5, x - s * 0.1, y - s * 0.8);
    g.fillStyle(0x3a4658, 1).fillTriangle(x + s * 0.9, y - s * 0.4, x + s * 0.5, y - s * 1.5, x + s * 0.1, y - s * 0.8);
  }

  /** Per-player score chips along the bottom of the board. */
  private drawScores(host: RenderHost, s: PogoState): void {
    const g = host.g;
    const y = POGO_BOARD.y + POGO_BOARD.size + 24;
    const n = s.players.length;
    const w = Math.min(190, (POGO_BOARD.size + 20) / Math.max(1, n));
    const x0 = POGO_BOARD.x + POGO_BOARD.size / 2 - (w * n) / 2;
    s.players.forEach((p, i) => {
      const x = x0 + i * w;
      const color = this.ctx.colorOf(p.id);
      g.fillStyle(0x1b1033, 0.85).fillRoundedRect(x + 3, y, w - 6, 52, 10);
      g.fillStyle(color, 1).fillRoundedRect(x + 3, y, 12, 52, { tl: 10, bl: 10, tr: 0, br: 0 });
      if (p.id === this.ctx.myId()) g.lineStyle(3, 0xffffff, 1).strokeRoundedRect(x + 3, y, w - 6, 52, 10);
      const label = host.label(`score:${p.id}`);
      label.setText(`${this.ctx.labelOf(p.id)}  ${p.score}${p.tiles > 0 ? ` (+${p.tiles})` : ''}`);
      label.setPosition(x + w / 2 + 6, y + 40).setVisible(!p.gone).setFontSize(18);
    });
  }
}
