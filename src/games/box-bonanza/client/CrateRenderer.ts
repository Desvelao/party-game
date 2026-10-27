import type Phaser from 'phaser';
import type { ClientContext, RenderHost } from '../../../core/client/src/plugins/api';
import { CRATE_ARENA } from '../shared/geometry';
import type { CrateKind, CratePickupKind, CratePlayerState, CrateState, CrateWeapon } from '../shared/types';

const PLAYER_R = 24;
const FALL_MS = 650;

interface Theme {
  floor: number;
  floorAlt: number;
  edge: number;
  line: number;
}
const THEMES: Record<string, Theme> = {
  'jungle-bonanza': { floor: 0x4f7a3a, floorAlt: 0x5a8844, edge: 0x2c4a22, line: 0x6fa557 },
  'space-bonanza': { floor: 0x3a4a78, floorAlt: 0x44558a, edge: 0x1d2644, line: 0x6a82c8 },
  'snow-bonanza': { floor: 0xdcefff, floorAlt: 0xcce4f8, edge: 0x7fb0d8, line: 0xffffff },
  'drain-bonanza': { floor: 0x4e5a3a, floorAlt: 0x57643f, edge: 0x2b3320, line: 0x7d8d57 },
};

/** Draws Box Bonanza: the arena floor (with holes), crates, pick-ups, shots, penguin and fighters. */
export class CrateRenderer {
  constructor(private readonly ctx: ClientContext) {}

  private fallenAt = new Map<string, number>();
  /** fuse labels used this frame / last frame (the unused ones are hidden), and the last beeped second per crate */
  private fuseLabels = new Set<string>();
  private prevFuseLabels = new Set<string>();
  private beeped = new Map<string, number>();
  private host: RenderHost | null = null;
  private tntFuse = 3;
  private weightTime = 5;
  private blastRadius = 130;

  reset(): void {
    this.fallenAt.clear();
    this.beeped.clear();
    for (const id of this.prevFuseLabels) this.host?.label(id).setVisible(false);
    this.prevFuseLabels.clear();
  }

  markFallen(id: string): void {
    this.fallenAt.set(id, performance.now());
  }

  render(host: RenderHost, a: CrateState, b: CrateState, latest: CrateState, alpha: number): void {
    const g = host.g;
    const now = performance.now();
    this.host = host;
    this.tntFuse = latest.tntFuse;
    this.blastRadius = latest.blastRadius;
    this.weightTime = latest.weightTime;
    this.fuseLabels = new Set();
    this.drawFloor(g, latest);

    // danger zones first, so crates and fighters stay readable on top of them
    for (const c of latest.crates) {
      if (c.k === 'tnt' && c.fuse >= 0) this.drawDanger(g, c.x, c.y, c.fuse, now);
    }
    for (const p of latest.players) {
      if (p.alive && p.holdFuse >= 0) this.drawDanger(g, p.x, p.y - PLAYER_R - 20, p.holdFuse, now);
    }

    // pick-ups
    const bob = Math.sin(now / 240) * 3;
    for (const it of latest.pickups) this.drawPickup(g, it.k, it.x, it.y + bob, 20);

    // crates (interpolated by id)
    const aC = new Map(a.crates.map((c) => [c.id, c]));
    const bC = new Map(b.crates.map((c) => [c.id, c]));
    for (const c of latest.crates) {
      const ca = aC.get(c.id) ?? c;
      const cb = bC.get(c.id) ?? c;
      const x = this.ctx.lerp(ca.x, cb.x, alpha);
      const y = this.ctx.lerp(ca.y, cb.y, alpha);
      this.drawCrate(g, c.k, x, y, 22, c.fuse, c.moving, now, `c${c.id}`);
    }

    // what a pick up would take right now, for the local player
    const mine = latest.players.find((p) => p.id === this.ctx.myId());
    const tgt = mine && mine.alive && mine.target >= 0 ? latest.crates.find((c) => c.id === mine.target) : undefined;
    if (tgt) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 130);
      g.lineStyle(3, 0xffffff, 0.55 + 0.4 * pulse).strokeRoundedRect(tgt.x - 28, tgt.y - 28, 56, 56, 9);
      g.lineStyle(3, 0xffffff, 0.8).lineBetween(tgt.x - 8, tgt.y - 36 - 3 * pulse, tgt.x, tgt.y - 29 - 3 * pulse).lineBetween(tgt.x + 8, tgt.y - 36 - 3 * pulse, tgt.x, tgt.y - 29 - 3 * pulse);
    }

    // penguin
    if (latest.penguin) this.drawPenguin(g, latest.penguin.x, latest.penguin.y, latest.penguin.awake, latest.penguin.a, now);

    // fighters
    const aP = new Map(a.players.map((p) => [p.id, p]));
    const bP = new Map(b.players.map((p) => [p.id, p]));
    for (const p of latest.players) {
      const pa = aP.get(p.id) ?? p;
      const pb = bP.get(p.id) ?? p;
      this.drawFighter(host, p, this.ctx.lerp(pa.x, pb.x, alpha), this.ctx.lerp(pa.y, pb.y, alpha), latest.maxHp, now);
    }

    // shots
    for (const s of latest.shots) {
      if (s.k === 'ring') {
        g.lineStyle(12, 0x7fe7ff, 0.8).strokeCircle(s.x, s.y, 100 + Math.sin(now / 40) * 8);
        g.lineStyle(4, 0xffffff, 0.9).strokeCircle(s.x, s.y, 112);
      } else if (s.k === 'missile') {
        g.fillStyle(0xffffff, 1).fillCircle(s.x, s.y, 9);
        g.fillStyle(0xff3b3b, 1).fillCircle(s.x, s.y, 5);
      } else {
        g.fillStyle(0xc77bff, 0.5).fillCircle(s.x, s.y, 20);
        g.fillStyle(0xe9c8ff, 1).fillCircle(s.x, s.y, 11);
        g.fillStyle(0xffffff, 1).fillCircle(s.x - 3, s.y - 3, 4);
      }
    }

    // countdown labels of crates that are no longer lit (exploded, thrown away...) disappear
    for (const id of this.prevFuseLabels) {
      if (!this.fuseLabels.has(id)) {
        host.label(id).setVisible(false);
        this.beeped.delete(id);
      }
    }
    this.prevFuseLabels = this.fuseLabels;
  }

  private drawFloor(g: Phaser.GameObjects.Graphics, s: CrateState): void {
    const th = THEMES[s.variant] ?? THEMES['jungle-bonanza'];
    const { x, y, size } = CRATE_ARENA;
    g.fillStyle(0x000000, 0.35).fillRoundedRect(x - 6, y - 2, size + 18, size + 18, 18);
    g.fillStyle(th.edge, 1).fillRoundedRect(x - 14, y - 14, size + 28, size + 28, 18);
    if (s.tiles > 0) {
      const n = s.tiles;
      const t = size / n;
      // void behind the tiles so holes read as holes
      g.fillStyle(0x07040f, 1).fillRect(x, y, size, size);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (s.holes[r * n + c]) continue;
          g.fillStyle((r + c) % 2 === 0 ? th.floor : th.floorAlt, 1).fillRect(x + c * t + 1, y + r * t + 1, t - 2, t - 2);
        }
      }
    } else {
      g.fillStyle(th.floor, 1).fillRect(x, y, size, size);
      g.lineStyle(2, th.line, 0.5);
      for (let i = 1; i < 8; i++) {
        const o = (size / 8) * i;
        g.lineBetween(x + o, y, x + o, y + size).lineBetween(x, y + o, x + size, y + o);
      }
    }
  }

  /** The heavy iron weight: kettlebell shape with a handle ring; flashes red as time runs out. */
  private drawWeight(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, now: number, urgency: number): void {
    const flash = urgency > 0 && Math.floor(now / (urgency > 0.6 ? 90 : 200)) % 2 === 0;
    g.fillStyle(0x000000, 0.3).fillEllipse(x + 2, y + s * 1.05, s * 1.9, s * 0.5);
    g.lineStyle(Math.max(3, s * 0.28), 0x2a2a35, 1).strokeCircle(x, y - s * 0.55, s * 0.55);
    g.fillStyle(flash ? 0xff3b3b : 0x4a4a58, 1).fillCircle(x, y + s * 0.2, s * 0.95);
    g.lineStyle(3, 0x15151d, 1).strokeCircle(x, y + s * 0.2, s * 0.95);
    g.fillStyle(0xffffff, 0.35).fillCircle(x - s * 0.32, y - s * 0.1, s * 0.22);
    g.fillStyle(0xe8e8f0, 0.9).fillRect(x - s * 0.34, y + s * 0.1, s * 0.68, s * 0.14);
    g.fillRect(x - s * 0.07, y + s * 0.1, s * 0.14, s * 0.58);
  }

  /** Red blast-area warning around a lit TNT that grows more insistent as the countdown runs out. */
  private drawDanger(g: Phaser.GameObjects.Graphics, x: number, y: number, fuse: number, now: number): void {
    const urgency = 1 - Math.min(1, Math.max(0, fuse / this.tntFuse));
    const R = this.blastRadius;
    const pulse = 0.5 + 0.5 * Math.sin(now / (160 - 100 * urgency));
    g.fillStyle(0xff2a2a, 0.06 + 0.12 * urgency + 0.06 * pulse * urgency).fillCircle(x, y, R);
    // dashed ring that spins faster as it gets urgent
    const dashes = 24;
    const spin = (now / 1000) * (0.4 + 2 * urgency);
    g.lineStyle(3 + 2 * urgency, 0xff3b3b, 0.5 + 0.4 * pulse);
    for (let i = 0; i < dashes; i++) {
      const a0 = spin + (i / dashes) * Math.PI * 2;
      g.beginPath().arc(x, y, R, a0, a0 + (Math.PI * 2) / dashes / 2, false).strokePath();
    }
  }

  private drawCrate(g: Phaser.GameObjects.Graphics, k: CrateKind, x: number, y: number, s: number, fuse: number, moving: boolean, now: number, key = ''): void {
    const urgency = fuse >= 0 ? 1 - Math.min(1, fuse / this.tntFuse) : 0;
    if (fuse >= 0) {
      // breathing and a nervous shake in the last second
      s *= 1 + 0.08 * Math.sin(now / (120 - 70 * urgency)) * (0.4 + urgency);
      if (fuse < 1) {
        x += Math.sin(now / 23) * 2.5;
        y += Math.cos(now / 29) * 2.5;
      }
    }
    g.fillStyle(0x000000, 0.28).fillEllipse(x + 3, y + s * 0.95, s * 1.9, s * 0.7);
    const lit = fuse >= 0 && Math.floor(now / (fuse < 0.4 ? 70 : 140 - 50 * urgency)) % 2 === 0;
    switch (k) {
      case 'block':
        g.fillStyle(0xb98a52, 1).fillRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.lineStyle(4, 0x6e4c24, 1).strokeRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.lineBetween(x - s, y - s, x + s, y + s).lineBetween(x + s, y - s, x - s, y + s);
        break;
      case 'locked':
        g.fillStyle(0x8e98a6, 1).fillRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.lineStyle(4, 0x4a5260, 1).strokeRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.fillStyle(0xffd23f, 1).fillRoundedRect(x - s * 0.3, y - s * 0.2, s * 0.6, s * 0.55, 3);
        g.lineStyle(3, 0xdddddd, 1).strokeCircle(x, y - s * 0.3, s * 0.28);
        break;
      case 'tnt':
        g.fillStyle(lit ? 0xffffff : 0xd62b2b, 1).fillRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.lineStyle(4, 0x6a0f0f, 1).strokeRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.fillStyle(0xffffff, 1).fillRect(x - s, y - s * 0.25, s * 2, s * 0.5);
        g.fillStyle(0x1b1033, 1).fillRect(x - s * 0.6, y - s * 0.15, s * 0.28, s * 0.3).fillRect(x - s * 0.15, y - s * 0.15, s * 0.28, s * 0.3).fillRect(x + s * 0.3, y - s * 0.15, s * 0.28, s * 0.3);
        break;
      case 'nitro':
        g.fillStyle(0x4fb04a, 1).fillRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.lineStyle(4, 0x1b4a1a, 1).strokeRoundedRect(x - s, y - s, s * 2, s * 2, 5);
        g.fillStyle(0xffffff, 1).fillRect(x - s * 0.1, y - s * 0.7, s * 0.2, s * 0.9).fillCircle(x, y + s * 0.55, s * 0.16);
        g.lineStyle(3, 0xfff08a, 0.9).strokeRoundedRect(x - s - 3, y - s - 3, s * 2 + 6, s * 2 + 6, 7);
        break;
    }
    if (moving) g.lineStyle(3, 0xffffff, 0.6).strokeCircle(x, y, s * 1.35);
    if (fuse >= 0) {
      g.lineStyle(4, 0xffd23f, 1).beginPath().arc(x, y, s * 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, fuse / this.tntFuse), false).strokePath();
      if (k === 'tnt' && key) this.drawCountdown(g, key, x, y, s, fuse);
    }
  }

  /** Everything that tells a player they carry the weight and how long they have. */
  private drawWeightCarrier(host: RenderHost, g: Phaser.GameObjects.Graphics, p: CratePlayerState, x: number, y: number, r: number, now: number): void {
    const urgency = 1 - Math.min(1, Math.max(0, p.weight));
    const secs = p.weight * this.weightTime;
    const last = secs < 2;
    const pulse = 0.5 + 0.5 * Math.sin(now / (200 - 120 * urgency));
    const tx = last ? Math.sin(now / 22) * 2.5 : 0; // the carrier trembles
    x += tx;
    // cracked ground and a growing shadow
    g.fillStyle(0x000000, 0.18 + 0.2 * urgency).fillEllipse(x, y + r * 0.8, r * (2.6 + urgency), r * (1.2 + 0.4 * urgency));
    g.lineStyle(3, 0x15151d, 0.7);
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05 + 0.4;
      g.lineBetween(x + Math.cos(a) * r * 0.9, y + r * 0.7 + Math.sin(a) * r * 0.35, x + Math.cos(a) * r * (1.5 + urgency), y + r * 0.7 + Math.sin(a) * r * 0.6 * (1.2 + urgency));
    }
    // heavy aura: violet at first, red in the last seconds
    const col = last ? 0xff3b3b : 0x8a6bff;
    g.fillStyle(col, 0.1 + 0.12 * pulse).fillCircle(x, y, r + 14);
    g.lineStyle(4, col, 0.7 + 0.3 * pulse).strokeCircle(x, y, r + 16 + 3 * pulse);
    // chains and the weight overhead, swinging
    const sw = Math.sin(now / 260) * 5 * (1 - 0.5 * urgency);
    const wy = y - r - 50;
    g.lineStyle(3, 0x9a9aa8, 1).lineBetween(x - 8, y - r + 2, x - 7 + sw, wy + 14).lineBetween(x + 8, y - r + 2, x + 7 + sw, wy + 14);
    this.drawWeight(g, x + sw, wy, 15, now, urgency);
    // seconds left on a dark badge (always readable) + a beep every second
    const n = Math.max(1, Math.ceil(secs - 1e-6));
    const id = `fuse:w${p.id}`;
    this.fuseLabels.add(id);
    if (this.beeped.get(id) !== n) {
      this.beeped.set(id, n);
      this.ctx.sfx(n <= 1 ? 'hazard' : 'tick');
    }
    g.fillStyle(0x1b1033, 0.92).fillCircle(x + sw + 24, wy - 8, 14);
    g.lineStyle(2, last ? 0xff5a4a : 0xffffff, 0.9).strokeCircle(x + sw + 24, wy - 8, 14);
    host
      .label(id)
      .setText(String(n))
      .setFontSize(20)
      .setColor(n <= 1 ? '#ff5a4a' : n === 2 ? '#ffd23f' : '#ffffff')
      .setStroke('#1b1033', 4)
      .setPosition(x + sw + 24, wy - 8)
      .setOrigin(0.5)
      .setAlpha(1)
      .setVisible(true);
  }

  /** The number of seconds left, inside the crate, plus a beep on every new second. */
  private drawCountdown(g: Phaser.GameObjects.Graphics, key: string, x: number, y: number, s: number, fuse: number): void {
    const host = this.host;
    if (!host) return;
    const n = Math.max(1, Math.ceil(fuse - 1e-6));
    const id = `fuse:${key}`;
    this.fuseLabels.add(id);
    const last = this.beeped.get(id);
    if (last !== n) {
      this.beeped.set(id, n);
      this.ctx.sfx(n <= 1 ? 'hazard' : 'tick');
    }
    // a dark badge keeps the digit readable on the red / white crate and on every flash frame
    g.fillStyle(0x1b1033, 0.9).fillCircle(x, y, s * 0.95);
    g.lineStyle(2, n <= 1 ? 0xff5a4a : 0xffffff, 0.9).strokeCircle(x, y, s * 0.95);
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

  private drawPickup(g: Phaser.GameObjects.Graphics, k: CratePickupKind, x: number, y: number, s: number): void {
    g.fillStyle(0x000000, 0.25).fillEllipse(x + 2, y + s * 1.05, s * 1.8, s * 0.6);
    switch (k) {
      case 'berry':
        g.fillStyle(0xf08a1c, 1).fillCircle(x, y, s * 0.85);
        g.lineStyle(3, 0x7a3a00, 1).strokeCircle(x, y, s * 0.85);
        g.fillStyle(0x4fb04a, 1).fillTriangle(x - 2, y - s * 0.8, x + s * 0.5, y - s * 1.3, x + s * 0.3, y - s * 0.6);
        g.fillStyle(0xffd9a0, 0.8).fillCircle(x - s * 0.3, y - s * 0.2, s * 0.2);
        break;
      case 'mask':
        g.fillStyle(0xffb347, 1).fillRoundedRect(x - s * 0.7, y - s, s * 1.4, s * 1.9, 10);
        g.lineStyle(3, 0x6e3a00, 1).strokeRoundedRect(x - s * 0.7, y - s, s * 1.4, s * 1.9, 10);
        g.fillStyle(0xd62b2b, 1).fillRect(x - s * 0.7, y - s * 0.6, s * 1.4, s * 0.35);
        g.fillStyle(0x1b1033, 1).fillCircle(x - s * 0.25, y + s * 0.1, s * 0.15).fillCircle(x + s * 0.25, y + s * 0.1, s * 0.15);
        break;
      case 'boots':
        g.fillStyle(0xffd23f, 1).fillRoundedRect(x - s * 0.9, y - s * 0.2, s * 1.8, s * 0.9, 5);
        g.fillRect(x - s * 0.9, y - s * 0.9, s * 0.8, s * 0.8);
        g.fillStyle(0xffffff, 1).fillRect(x - s * 0.9, y + s * 0.5, s * 1.8, s * 0.22);
        g.lineStyle(3, 0x1b1033, 1).strokeRoundedRect(x - s * 0.9, y - s * 0.2, s * 1.8, s * 0.9, 5);
        break;
      case 'z':
        g.fillStyle(0x6b4fd6, 1).fillCircle(x, y, s);
        g.lineStyle(3, 0x1b1033, 1).strokeCircle(x, y, s);
        g.lineStyle(6, 0xffffff, 1).lineBetween(x - s * 0.5, y - s * 0.5, x + s * 0.5, y - s * 0.5).lineBetween(x + s * 0.5, y - s * 0.5, x - s * 0.5, y + s * 0.5).lineBetween(x - s * 0.5, y + s * 0.5, x + s * 0.5, y + s * 0.5);
        break;
      case 'weight':
        this.drawWeight(g, x, y, s, performance.now(), 0);
        break;
      case 'qbox':
        g.fillStyle(0x8a3fd6, 1).fillRoundedRect(x - s, y - s, s * 2, s * 2, 6);
        g.lineStyle(4, 0xe9d0ff, 1).strokeRoundedRect(x - s, y - s, s * 2, s * 2, 6);
        g.lineStyle(6, 0xffffff, 1).beginPath().arc(x, y - s * 0.25, s * 0.38, Math.PI, Math.PI * 2.35, false).strokePath();
        g.lineStyle(6, 0xffffff, 1).lineBetween(x + s * 0.2, y + s * 0.1, x, y + s * 0.3).lineBetween(x, y + s * 0.3, x, y + s * 0.4);
        g.fillStyle(0xffffff, 1).fillCircle(x, y + s * 0.65, s * 0.12);
        break;
    }
  }

  private drawWeaponIcon(g: Phaser.GameObjects.Graphics, w: CrateWeapon, x: number, y: number, s: number): void {
    if (w === 'ring') {
      g.lineStyle(4, 0x7fe7ff, 1).strokeCircle(x, y, s * 0.8).strokeCircle(x, y, s * 0.4);
    } else if (w === 'missile') {
      g.fillStyle(0xffffff, 1).fillRoundedRect(x - s, y - s * 0.3, s * 1.6, s * 0.6, 5);
      g.fillStyle(0xff3b3b, 1).fillTriangle(x + s * 0.6, y - s * 0.3, x + s * 1.1, y, x + s * 0.6, y + s * 0.3);
    } else {
      g.fillStyle(0xc77bff, 1).fillCircle(x, y, s * 0.8);
      g.fillStyle(0xffffff, 1).fillCircle(x - s * 0.25, y - s * 0.25, s * 0.25);
    }
  }

  private drawPenguin(g: Phaser.GameObjects.Graphics, x: number, y: number, awake: boolean, a: number, now: number): void {
    g.fillStyle(0x000000, 0.28).fillEllipse(x + 4, y + 38, 90, 26);
    const wob = awake ? Math.sin(now / 60) * 4 : 0;
    g.fillStyle(0x1b2a44, 1).fillEllipse(x + wob, y, 78, 92);
    g.fillStyle(0xffffff, 1).fillEllipse(x + wob, y + 8, 50, 66);
    g.fillStyle(0xffa733, 1).fillTriangle(x - 8 + wob, y - 14, x + 8 + wob, y - 14, x + wob, y - 2);
    if (awake) {
      g.fillStyle(0xffffff, 1).fillCircle(x - 12 + wob, y - 26, 7).fillCircle(x + 12 + wob, y - 26, 7);
      g.fillStyle(0x111111, 1).fillCircle(x - 12 + wob, y - 26, 3).fillCircle(x + 12 + wob, y - 26, 3);
      g.lineStyle(5, 0xffffff, 0.7).strokeCircle(x, y, 56 + Math.sin(a * 6) * 4);
    } else {
      g.lineStyle(4, 0x111111, 1).lineBetween(x - 18, y - 26, x - 6, y - 26).lineBetween(x + 6, y - 26, x + 18, y - 26);
      g.fillStyle(0xffffff, 0.8).fillCircle(x + 36, y - 40 - Math.sin(now / 400) * 4, 5);
    }
  }

  private drawFighter(host: RenderHost, p: CratePlayerState, x: number, y: number, maxHp: number, now: number): void {
    const g = host.g;
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
    const r = PLAYER_R * scale;
    g.fillStyle(0x000000, 0.3).fillEllipse(x + 4, y + 8 * scale, r * 2, r * 1.4);
    if (p.spin) g.lineStyle(8, 0xffffff, 0.7).strokeCircle(x, y, r + 22 + Math.sin(now / 30) * 4);
    if (!(p.inv && Math.floor(now / 80) % 2 === 0)) this.ctx.drawCharacter(g, p.id, x, y, r, p.f);
    if (!p.alive) {
      host.label(p.id).setPosition(x, y - r - 10).setAlpha(scale).setVisible(true);
      return;
    }

    // status rings
    if (p.mask > 0) g.lineStyle(5, 0xffb347, 0.9).strokeCircle(x, y, r + 7);
    if (p.boots > 0) g.lineStyle(4, 0xffd23f, 0.9).strokeCircle(x, y, r + 12);
    if (p.slow > 0) g.lineStyle(4, 0x8a6bff, 0.9).strokeCircle(x, y, r + 12);
    if (p.weight > 0) this.drawWeightCarrier(host, g, p, x, y, r, now);
    // held crate in front of the player, in the facing direction
    if (p.hold) {
      const d = r + 11;
      this.drawCrate(g, p.hold, x + Math.cos(p.f) * d, y + Math.sin(p.f) * d, 14, p.holdFuse, false, now, `h${p.id}`);
    }
    // weapon + charges
    if (p.weapon) {
      this.drawWeaponIcon(g, p.weapon, x + r + 14, y - r - 8, 11);
      for (let i = 0; i < p.charges; i++) g.fillStyle(0xffffff, 1).fillCircle(x + r + 8 + i * 9, y - r + 8, 3);
    }
    // health bar
    const w = 56;
    const hp = Math.max(0, Math.min(1, p.hp / maxHp));
    const by = y + r + 14;
    g.fillStyle(0x000000, 0.6).fillRoundedRect(x - w / 2 - 2, by - 2, w + 4, 11, 4);
    g.fillStyle(hp > 0.5 ? 0x4cd964 : hp > 0.25 ? 0xffd23f : 0xff3b3b, 1).fillRoundedRect(x - w / 2, by, w * hp, 7, 3);
    host.label(p.id).setPosition(x, y - r - 10).setAlpha(1).setVisible(true);
  }
}
