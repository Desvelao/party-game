import type Phaser from 'phaser';
import { WORLD_SIZE } from '../../../core/shared/constants';
import type { ClientContext, RenderHost } from '../../../core/client/src/plugins/api';
import { polarEdge } from '../shared/geometry';
import type { PolarPlayerState, FrostShoveState } from '../shared/types';
import { drawFx, pushFx, resetFx, seeBears } from './effects';

const CENTER = WORLD_SIZE / 2;
const FALL_MS = 650;
const OUTLINE_STEPS = 72;

const FX_COLOR: Record<string, number> = {
  speed: 0xffd23f,
  giant: 0x7bff7b,
  lightning: 0xfff08a,
  weight: 0x8a8a8a,
  shrink: 0xff8ad8,
  freeze: 0x7fd8ff,
  dismounted: 0xff5a5a,
};

/** Draws Frost Shove and its variants: the ice floe, bears, power-ups and per-variant hazards. */
export class FrostShoveRenderer {
  constructor(private readonly ctx: ClientContext) {}

  private fallenAt = new Map<string, number>();
  /** per bear: the last climb progress seen and when it last rose (a press), to animate the hang on the edge */
  private prevFall = new Map<string, number>();
  private lastPress = new Map<string, number>();

  reset(): void {
    this.fallenAt.clear();
    this.prevFall.clear();
    this.lastPress.clear();
    resetFx();
  }

  /** A bear was eliminated: start its sink animation. */
  markFallen(id: string): void {
    this.fallenAt.set(id, performance.now());
  }

  render(host: RenderHost, a: FrostShoveState, b: FrostShoveState, latest: FrostShoveState, alpha: number): void {
    const g = host.g;
    const sectors = latest.sectors.map((r, i) => this.ctx.lerp(a.sectors[i] ?? r, b.sectors[i] ?? r, alpha));
    const tx = this.ctx.lerp(a.tilt.x, b.tilt.x, alpha);
    const ty = this.ctx.lerp(a.tilt.y, b.tilt.y, alpha);
    this.drawIce(g, sectors, tx, ty);
    if (latest.wall !== undefined) this.drawWall(g, sectors, latest.wall);
    if (latest.bolts) this.drawBolts(g, latest.bolts);
    if (latest.walrus) this.drawWalrus(g, latest.walrus);
    if (latest.melts) this.drawMelts(g, sectors, latest.melts, performance.now());
    if (latest.beam) this.drawBeamSpot(g, latest.beam, performance.now());
    this.drawItems(g, latest);
    seeBears(latest.players);

    const aById = new Map(a.players.map((p) => [p.id, p]));
    const bById = new Map(b.players.map((p) => [p.id, p]));
    const now = performance.now();
    for (const p of latest.players) {
      const pa = aById.get(p.id) ?? p;
      const pb = bById.get(p.id) ?? p;
      this.drawBear(host, p, this.ctx.lerp(pa.x, pb.x, alpha), this.ctx.lerp(pa.y, pb.y, alpha), now);
    }

    drawFx(g, now, this.ctx.motion());
    if (latest.beam) {
      const pb = a.beam;
      const nb = b.beam;
      const lerp = pb && nb && pb.ph === nb.ph ? { ...latest.beam, x: this.ctx.lerp(pb.x, nb.x, alpha), y: this.ctx.lerp(pb.y, nb.y, alpha) } : latest.beam;
      this.drawDispenser(g, lerp, now);
    }

    if (latest.flying) {
      for (const f of latest.flying) {
        g.fillStyle(0x000000, 0.3).fillCircle(f.x + 3, f.y + 8, 12);
        g.fillStyle(0x222222, 1).fillCircle(f.x, f.y, 12);
        g.fillStyle(0xff7a1a, 1).fillCircle(f.x + 6, f.y - 10, 5);
      }
    }
  }

  private outline(sectors: number[], pad: number, ox = 0, oy = 0): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < OUTLINE_STEPS; i++) {
      const ang = (i / OUTLINE_STEPS) * Math.PI * 2;
      const r = polarEdge(sectors, ang) + pad;
      pts.push({ x: CENTER + ox + Math.cos(ang) * r, y: CENTER + oy + Math.sin(ang) * r });
    }
    return pts;
  }

  /** the wall: one block of ice per sector still standing, on the rim */
  private drawWall(g: Phaser.GameObjects.Graphics, sectors: number[], mask: number): void {
    const n = sectors.length;
    const step = (Math.PI * 2) / n;
    const gap = step * 0.06;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const pts: { x: number; y: number }[] = [];
      for (const [pad, dir] of [[-14, 1], [12, -1]] as const) {
        for (let k = 0; k <= 4; k++) {
          const ang = (i - 0.5) * step + gap + ((step - gap * 2) * (dir === 1 ? k : 4 - k)) / 4;
          const r = polarEdge(sectors, ang) + pad;
          pts.push({ x: CENTER + Math.cos(ang) * r, y: CENTER + Math.sin(ang) * r });
        }
      }
      g.fillStyle(0xe8f8ff, 1).fillPoints(pts, true);
      g.lineStyle(3, 0x4a86b8, 1).strokePoints(pts, true);
    }
  }

  /**
   * The floe, tipped by the tilt (tx, ty: unit-ish vector pointing downhill): a visible slab wall on the high side, a
   * slope shaded towards the low side where the water washes over the rim, and the rings drifting uphill.
   */
  private drawIce(g: Phaser.GameObjects.Graphics, sectors: number[], tx: number, ty: number): void {
    const tm = Math.min(1, Math.hypot(tx, ty));
    const ux = tm > 0.001 ? tx / Math.hypot(tx, ty) : 0;
    const uy = tm > 0.001 ? ty / Math.hypot(tx, ty) : 0;
    const maxR = Math.max(...sectors);
    const t = this.ctx.motion() > 0 ? performance.now() / 1000 : 0;
    g.fillStyle(0x0d2a4d, 0.55).fillPoints(this.outline(sectors, 70), true);
    g.fillStyle(0x000000, 0.3).fillPoints(this.outline(sectors, 14, 8 + ux * tm * 26, 12 + uy * tm * 26), true);
    // the slab: its wall shows on the high side
    if (tm > 0.05) {
      g.fillStyle(0x2f6a9c, 1).fillPoints(this.outline(sectors, 12, -ux * tm * 20, -uy * tm * 20), true);
      g.fillStyle(0x4f8fc4, 1).fillPoints(this.outline(sectors, 12, -ux * tm * 10, -uy * tm * 10), true);
    }
    g.fillStyle(0x6fa8d6, 1).fillPoints(this.outline(sectors, 12), true);
    const top = this.outline(sectors, 0);
    g.fillStyle(0xcdeeff, 1).fillPoints(top, true);
    if (tm > 0.05) {
      // the slope: darker towards the low side, a highlight on the raised rim
      for (const [thr, a] of [[-0.45, 0.07], [0, 0.08], [0.45, 0.1]] as const) {
        const part = clipHalf(top, ux, uy, thr * maxR);
        if (part.length > 2) g.fillStyle(0x1e5fa8, a * tm * 2).fillPoints(part, true);
      }
      const rim = clipHalf(top, -ux, -uy, 0.62 * maxR);
      if (rim.length > 2) g.fillStyle(0xffffff, 0.35 * tm).fillPoints(rim, true);
    }
    g.lineStyle(3, 0xffffff, 0.5);
    for (let r = 90; r < maxR; r += 90) {
      g.beginPath();
      const shift = (r / maxR) * tm * 10;
      for (let i = 0; i <= OUTLINE_STEPS; i++) {
        const ang = (i / OUTLINE_STEPS) * Math.PI * 2;
        const rr = Math.min(r, polarEdge(sectors, ang) - 4);
        const x = CENTER + Math.cos(ang) * rr - ux * shift;
        const y = CENTER + Math.sin(ang) * rr - uy * shift;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    if (tm > 0.05) {
      // the low side dips: water washes over the rim, foam on its edge
      const wash = clipHalf(this.outline(sectors, 20), ux, uy, (0.78 - 0.25 * tm) * maxR);
      if (wash.length > 2) g.fillStyle(0x7fd8ff, 0.4 * tm).fillPoints(wash, true);
      const foam = 5 + 9 * tm + (this.ctx.motion() > 0 ? Math.sin(t * 4) * 2 : 0);
      g.lineStyle(foam, 0xffffff, 0.55 * tm);
      g.beginPath();
      let pen = false;
      for (let i = 0; i <= OUTLINE_STEPS; i++) {
        const ang = (i / OUTLINE_STEPS) * Math.PI * 2;
        const rr = polarEdge(sectors, ang) + 4;
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * rr;
        if (px * ux + py * uy < (0.7 - 0.2 * tm) * maxR) {
          pen = false;
          continue;
        }
        if (!pen) g.moveTo(CENTER + px, CENTER + py);
        else g.lineTo(CENTER + px, CENTER + py);
        pen = true;
      }
      g.strokePath();
    }
  }

  /** Tip Tumble's visitor: the fish arcs out of the water onto the ice, the walrus slides in behind it, takes it and leaves */
  private drawWalrus(g: Phaser.GameObjects.Graphics, w: NonNullable<FrostShoveState['walrus']>): void {
    const m = this.ctx.motion();
    const dx = Math.cos(w.a);
    const dy = Math.sin(w.a);
    const at = (d: number, lift = 0) => ({ x: CENTER + dx * d, y: CENTER + dy * d - lift });
    const WATER = 120; // px beyond the resting spot where they come out of the water
    const ease = (k: number) => k * k * (3 - 2 * k);
    if (w.ph === 'fish' || w.ph === 'in' || (w.ph === 'eat' && w.k < 0.6)) {
      // the fish: a jump from the water, then it flops on the spot
      const k = w.ph === 'fish' ? w.k : 1;
      const hop = w.ph === 'fish' && m > 0 ? Math.sin(Math.PI * k) * 90 : 0;
      const flop = k >= 1 && m > 0 ? Math.sin(performance.now() / 70) * 0.5 : 0;
      const p = at(w.r + (w.ph === 'fish' ? WATER * (1 - ease(k)) : 0), hop);
      const rot = Math.atan2(dy, dx) + Math.PI + flop + (w.ph === 'fish' && m > 0 ? (k - 0.5) * 1.6 : 0);
      g.fillStyle(0x000000, 0.2).fillEllipse(p.x + 4, p.y + hop + 12, 40, 12);
      g.fillStyle(0xff9a3c, 1).fillPoints(ellipsePts(p.x, p.y, 22, 11, rot), true);
      g.fillPoints([{ x: p.x + Math.cos(rot) * 18, y: p.y + Math.sin(rot) * 18 }, { x: p.x + Math.cos(rot + 0.5) * 34, y: p.y + Math.sin(rot + 0.5) * 34 }, { x: p.x + Math.cos(rot - 0.5) * 34, y: p.y + Math.sin(rot - 0.5) * 34 }], true);
      g.fillStyle(0xffffff, 1).fillCircle(p.x - Math.cos(rot) * 12, p.y - Math.sin(rot) * 12 - 3, 3.5);
      g.fillStyle(0x111111, 1).fillCircle(p.x - Math.cos(rot) * 13, p.y - Math.sin(rot) * 13 - 3, 1.6);
    }
    if (w.ph === 'in' || w.ph === 'eat' || w.ph === 'out') {
      const k = w.ph === 'in' ? ease(w.k) : w.ph === 'out' ? 1 - ease(w.k) : 1;
      const d = w.r + (m > 0 ? WATER * 1.1 * (1 - k) : 0);
      const lunge = w.ph === 'eat' && m > 0 ? Math.max(0, Math.sin(w.k * Math.PI * 3)) * 14 : 0;
      const p = at(d - lunge);
      const face = Math.atan2(dy, dx) + Math.PI; // looks at the centre
      g.fillStyle(0x000000, 0.25).fillEllipse(p.x + 6, p.y + 18, 120, 36);
      g.fillStyle(0x8a6a4f, 1).fillPoints(ellipsePts(p.x, p.y, 64, 40, face), true);
      g.lineStyle(4, 0x4a3524, 1).strokePoints(ellipsePts(p.x, p.y, 64, 40, face), true);
      const hx = p.x + Math.cos(face) * 52;
      const hy = p.y + Math.sin(face) * 52;
      g.fillStyle(0xa07f5f, 1).fillCircle(hx, hy, 24);
      g.lineStyle(4, 0x4a3524, 1).strokeCircle(hx, hy, 24);
      // tusks, eyes, flippers
      for (const s of [-1, 1]) {
        const nx = -Math.sin(face) * s;
        const ny = Math.cos(face) * s;
        g.lineStyle(6, 0xfff6e0, 1).lineBetween(hx + Math.cos(face) * 12 + nx * 8, hy + Math.sin(face) * 12 + ny * 8, hx + Math.cos(face) * 36 + nx * 10, hy + Math.sin(face) * 36 + ny * 10);
        g.fillStyle(0xffffff, 1).fillCircle(hx - Math.cos(face) * 2 + nx * 10, hy - Math.sin(face) * 2 + ny * 10, 4.5);
        g.fillStyle(0x111111, 1).fillCircle(hx + Math.cos(face) * 1 + nx * 10, hy + Math.sin(face) * 1 + ny * 10, 2.2);
        g.fillStyle(0x6d513a, 1).fillPoints(ellipsePts(p.x + nx * 40, p.y + ny * 40, 20, 9, face + s * 0.5), true);
      }
      if (m > 0 && (w.ph === 'in' ? w.k < 0.7 : w.ph === 'out' && w.k > 0.3)) {
        // splash where it passes the water line
        const q = w.ph === 'in' ? w.k / 0.7 : (w.k - 0.3) / 0.7;
        const c = at(w.r + WATER * 0.5);
        g.lineStyle(6 * (1 - q) + 1, 0xffffff, 0.8 * (1 - q)).strokeCircle(c.x, c.y, 20 + 70 * q);
      }
    }
  }

  private drawBolts(g: Phaser.GameObjects.Graphics, bolts: NonNullable<FrostShoveState['bolts']>): void {
    const L = WORLD_SIZE;
    for (const b of bolts) {
      const cos = Math.cos(b.a);
      const sin = Math.sin(b.a);
      const cx = CENTER - sin * b.d;
      const cy = CENTER + cos * b.d;
      const x1 = cx - cos * L;
      const y1 = cy - sin * L;
      const x2 = cx + cos * L;
      const y2 = cy + sin * L;
      if (!b.on) {
        g.lineStyle(4, 0xff3b3b, 0.25 + 0.5 * (1 - b.warn));
        g.lineBetween(x1, y1, x2, y2);
      } else {
        g.lineStyle(34, 0xfff08a, 0.45).lineBetween(x1, y1, x2, y2);
        g.lineStyle(16, 0xffffff, 0.95).lineBetween(x1, y1, x2, y2);
      }
      // generators at both ends of the line, outside the floe
      const gx = CENTER - sin * b.d;
      const gy = CENTER + cos * b.d;
      for (const s of [-1, 1]) {
        g.fillStyle(0x444466, 1).fillCircle(gx + cos * 470 * s, gy + sin * 470 * s, 22);
        g.fillStyle(b.on ? 0xffffff : 0xff3b3b, 1).fillCircle(gx + cos * 470 * s, gy + sin * 470 * s, 9);
      }
    }
  }

  private drawItems(g: Phaser.GameObjects.Graphics, s: FrostShoveState): void {
    const bob = Math.sin(performance.now() / 250) * 3;
    for (const it of s.items) {
      g.fillStyle(0x000000, 0.25).fillEllipse(it.x + 3, it.y + 16, 36, 12);
      g.fillStyle(0x222222, 1).fillCircle(it.x, it.y + bob, 16);
      g.lineStyle(3, 0xff7a1a, 1).strokeCircle(it.x, it.y + bob, 16);
      g.fillStyle(0xff7a1a, 1).fillCircle(it.x + 9, it.y - 14 + bob, 5);
    }
  }

  /** A power-up tile: coloured rounded square (white border = good, red = bad) with its own glyph. */
  private drawPowerIcon(g: Phaser.GameObjects.Graphics, fx: string, x: number, y: number, h: number): void {
    const color = FX_COLOR[fx] ?? 0xffffff;
    const bad = fx === 'weight' || fx === 'shrink' || fx === 'freeze' || fx === 'dismounted';
    g.fillStyle(0x1b1033, 1).fillRoundedRect(x - h, y - h, h * 2, h * 2, h * 0.35);
    g.lineStyle(Math.max(3, h * 0.17), bad ? 0xff4d4d : 0xffffff, 1).strokeRoundedRect(x - h, y - h, h * 2, h * 2, h * 0.35);
    g.fillStyle(color, 1).lineStyle(Math.max(2, h * 0.14), color, 1);
    const u = h / 24; // glyphs are authored on a 24-unit half-size
    const P = (px: number, py: number) => ({ x: x + px * u, y: y + py * u });
    switch (fx) {
      case 'lightning': // lightning bolt
        g.fillPoints([P(4, -18), P(-10, 3), P(-1, 3), P(-5, 18), P(11, -4), P(2, -4)], true);
        break;
      case 'speed': // two chevrons pointing forward
        for (const o of [-9, 3]) g.fillPoints([P(o, -15), P(o + 9, -15), P(o + 18, 0), P(o + 9, 15), P(o, 15), P(o + 9, 0)], true);
        break;
      case 'giant': // arrows pointing out of a centre dot
      case 'shrink': {
        // arrows pointing in
        const dir = fx === 'giant' ? 1 : -1;
        g.fillCircle(x, y, 4 * u);
        for (const [ax, ay] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const tip = dir === 1 ? 17 : 8;
          const base = dir === 1 ? 7 : 17;
          g.lineBetween(x + ax * base * u, y + ay * base * u, x + ax * tip * u, y + ay * tip * u);
          g.fillTriangle(
            x + ax * tip * u, y + ay * tip * u,
            x + ax * (tip - dir * 8) * u, y + ay * tip * u,
            x + ax * tip * u, y + ay * (tip - dir * 8) * u,
          );
        }
        break;
      }
      case 'weight': // a heavy block with a handle and "kg" bar
        g.fillRoundedRect(x - 15 * u, y - 4 * u, 30 * u, 18 * u, 3 * u);
        g.fillPoints([P(-9, -4), P(-5, -14), P(5, -14), P(9, -4)], true);
        g.fillStyle(0x1b1033, 1).fillRect(x - 8 * u, y + 3 * u, 16 * u, 3 * u);
        break;
      case 'freeze': // snowflake
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI) / 3;
          g.lineBetween(x - Math.cos(a) * 17 * u, y - Math.sin(a) * 17 * u, x + Math.cos(a) * 17 * u, y + Math.sin(a) * 17 * u);
        }
        g.fillCircle(x, y, 4 * u);
        break;
      default: // dismounted: a "!" mark
        g.fillRect(x - 3 * u, y - 16 * u, 6 * u, 20 * u).fillCircle(x, y + 12 * u, 4 * u);
    }
  }

  /** the beam seen from above: a ring while it aims, a glowing disc of light on the ice while it is live */
  private drawBeamSpot(g: Phaser.GameObjects.Graphics, b: NonNullable<FrostShoveState['beam']>, now: number): void {
    if (b.ph !== 'aim' && b.ph !== 'on') return;
    const m = this.ctx.motion();
    const color = b.who === 'warden' ? 0xff3b6b : 0x9fe8ff;
    const pulse = m > 0 ? 0.5 + 0.5 * Math.sin(now / 120) : 0.5;
    if (b.ph === 'aim') {
      g.lineStyle(4, color, 0.4 + 0.4 * pulse).strokeCircle(b.sx, b.sy, b.r * (1.25 - 0.25 * b.k));
      g.lineStyle(2, 0xffffff, 0.5).strokeCircle(b.sx, b.sy, b.r);
      return;
    }
    g.fillStyle(color, 0.16).fillCircle(b.sx, b.sy, b.r * 1.35);
    g.fillStyle(color, 0.3 + 0.1 * pulse).fillCircle(b.sx, b.sy, b.r);
    g.fillStyle(0xffffff, 0.35 + 0.15 * pulse).fillCircle(b.sx, b.sy, b.r * 0.6);
    g.lineStyle(4, 0xffffff, 0.8).strokeCircle(b.sx, b.sy, b.r);
    // rays turning inside the beam, and sparkles rising out of it
    const spin = m > 0 ? now / 900 : 0;
    g.lineStyle(3, 0xffffff, 0.5);
    for (let i = 0; i < 6; i++) {
      const a = spin + (i * Math.PI) / 3;
      g.lineBetween(b.sx + Math.cos(a) * b.r * 0.2, b.sy + Math.sin(a) * b.r * 0.2, b.sx + Math.cos(a) * b.r * 0.95, b.sy + Math.sin(a) * b.r * 0.95);
    }
    if (m > 0) {
      for (let i = 0; i < 5; i++) {
        const q = ((now / 900 + i / 5) % 1);
        g.fillStyle(0xffffff, 1 - q).fillCircle(b.sx + Math.sin(i * 2.4) * b.r * 0.6, b.sy - q * 70, 3);
      }
    }
  }

  /** the dispenser floating above the floe: a hovering robot, or the Gruff mask in Thaw Frenzy */
  private drawDispenser(g: Phaser.GameObjects.Graphics, b: NonNullable<FrostShoveState['beam']>, now: number): void {
    const m = this.ctx.motion();
    const bob = m > 0 ? Math.sin(now / 300) * 5 : 0;
    const lift = (b.ph === 'idle' || b.ph === 'back' ? 36 : 64) + bob;
    const x = b.x;
    const y = b.y - lift;
    const glow = b.ph === 'on' || b.ph === 'aim' || b.ph === 'melt';
    g.fillStyle(0x000000, 0.22).fillEllipse(b.x + 6, b.y + 6, 70, 22);
    if (b.ph === 'melt' && b.who === 'warden') {
      // the heat ray down onto the rim: flickering, widening, with a flare where it lands
      const flick = m > 0 ? 0.6 + 0.4 * Math.sin(now / 45) : 0.8;
      g.fillStyle(0xff7a1a, 0.35 * flick).fillTriangle(x - 8, y + 34, x + 8, y + 34, b.x, b.y + 30);
      g.fillStyle(0xffd23f, 0.3 * flick).fillTriangle(x - 8, y + 34, x + 8, y + 34, b.x - 40, b.y);
      g.fillTriangle(x - 8, y + 34, x + 8, y + 34, b.x + 40, b.y);
      g.fillStyle(0xff3b3b, 0.35 * flick).fillCircle(b.x, b.y, 26 + 22 * b.k);
      g.fillStyle(0xffffff, 0.5 * flick).fillCircle(b.x, b.y, 12 + 8 * b.k);
      if (m > 0) {
        for (let i = 0; i < 6; i++) {
          const q = (now / 600 + i / 6) % 1;
          g.fillStyle(0xffd23f, 1 - q).fillCircle(b.x + Math.sin(i * 2.7) * 34, b.y - q * 60, 3);
        }
      }
    }
    if (b.who === 'warden') {
      if (glow) g.fillStyle(0xff3b6b, 0.25).fillCircle(x, y, 52);
      g.fillStyle(0x3a1560, 1).fillTriangle(x - 26, y - 14, x - 18, y - 48, x - 6, y - 24);
      g.fillTriangle(x + 26, y - 14, x + 18, y - 48, x + 6, y - 24);
      g.fillStyle(0x5a2a8c, 1).fillEllipse(x, y, 62, 74);
      g.lineStyle(4, 0x1b1033, 1).strokeEllipse(x, y, 62, 74);
      g.fillStyle(0xff3b3b, 1).fillTriangle(x - 20, y - 12, x - 4, y - 4, x - 18, y + 4);
      g.fillTriangle(x + 20, y - 12, x + 4, y - 4, x + 18, y + 4);
      g.fillStyle(0xffd23f, glow ? 1 : 0.6).fillCircle(x - 13, y - 3, 3).fillCircle(x + 13, y - 3, 3);
      g.lineStyle(4, 0xfff6e0, 1);
      g.beginPath();
      g.moveTo(x - 14, y + 20);
      for (let i = 1; i <= 6; i++) g.lineTo(x - 14 + i * (28 / 6), y + 20 + (i % 2 ? 8 : 0));
      g.strokePath();
    } else {
      const spin = m > 0 ? now / 60 : 0;
      for (const side of [-1, 1]) {
        // rotors
        g.fillStyle(0x6b7a89, 0.55).fillEllipse(x + side * 34, y - 14, 30 + 8 * Math.sin(spin * side), 8);
        g.fillStyle(0x6b7a89, 1).fillRect(x + side * 22 - 2, y - 14, 4, 12);
      }
      g.fillStyle(0xb8c4d0, 1).fillEllipse(x, y, 58, 42);
      g.lineStyle(4, 0x33414f, 1).strokeEllipse(x, y, 58, 42);
      g.fillStyle(0x7fd8ff, 0.9).fillEllipse(x, y - 10, 30, 20);
      g.fillStyle(0xffffff, 0.7).fillEllipse(x - 6, y - 14, 10, 6);
      g.fillStyle(glow ? 0xfff08a : 0x33414f, 1).fillCircle(x, y + 12, 8);
      if (glow) g.lineStyle(3, 0xffffff, 0.8).lineBetween(x, y + 16, x, y + lift - 4);
    }
  }

  /** the rim glowing and cracking where a bite is about to melt out of it */
  private drawMelts(g: Phaser.GameObjects.Graphics, sectors: number[], melts: NonNullable<FrostShoveState['melts']>, now: number): void {
    const n = sectors.length;
    const step = (Math.PI * 2) / n;
    const m = this.ctx.motion();
    for (const mt of melts) {
      const pulse = m > 0 ? 0.5 + 0.5 * Math.sin(now / 90) : 0.5;
      const pts: { x: number; y: number }[] = [];
      for (const [pad, dir] of [[-26, 1], [6, -1]] as const) {
        for (let k = 0; k <= 8; k++) {
          const ang = (mt.i - 1.5) * step + (3 * step * (dir === 1 ? k : 8 - k)) / 8;
          const r = polarEdge(sectors, ang) + pad;
          pts.push({ x: CENTER + Math.cos(ang) * r, y: CENTER + Math.sin(ang) * r });
        }
      }
      g.fillStyle(0xff7a1a, 0.04 + 0.11 * Math.min(1, mt.k * 4) + 0.35 * mt.k * (0.6 + 0.4 * pulse)).fillPoints(pts, true);
      // cracks
      g.lineStyle(3, 0xffd23f, 0.4 + 0.5 * mt.k);
      for (let c = 0; c < 4; c++) {
        const ang = (mt.i - 1 + c * 0.5) * step;
        const r0 = polarEdge(sectors, ang);
        const len = 30 + 30 * mt.k;
        const j = Math.sin(mt.i * 7 + c * 3.1) * 0.1;
        g.lineBetween(CENTER + Math.cos(ang) * (r0 - len), CENTER + Math.sin(ang) * (r0 - len), CENTER + Math.cos(ang + j) * (r0 - 4), CENTER + Math.sin(ang + j) * (r0 - 4));
      }
      if (m > 0) {
        // steam rising
        for (let c = 0; c < 4; c++) {
          const q = (now / 700 + c / 4) % 1;
          const ang = (mt.i + (c - 1.5) * 0.35) * step;
          const r0 = polarEdge(sectors, ang) - 10;
          g.fillStyle(0xffffff, (1 - q) * 0.5 * mt.k).fillCircle(CENTER + Math.cos(ang) * r0, CENTER + Math.sin(ang) * r0 - q * 50, 8 + q * 14);
        }
      }
    }
  }

  /** presses and the way back onto the ice show as changes of the climb progress between frames */
  private trackClimb(p: PolarPlayerState, x: number, y: number, ox: number, oy: number, now: number, m: number): void {
    const prev = this.prevFall.get(p.id) ?? 0;
    this.prevFall.set(p.id, p.alive ? p.fall : 0);
    const mine = p.id === this.ctx.myId();
    if (p.alive && p.fall > prev + 0.1) {
      // a press: ice chips fly inland, droplets outwards
      this.lastPress.set(p.id, now);
      if (m > 0) {
        pushFx({ k: 'chips', x: x - ox * p.r, y: y - oy * p.r, dx: -ox, dy: -oy, dur: 450 });
        pushFx({ k: 'splash', x: x + ox * p.r * 0.6, y: y + oy * p.r * 0.6, dx: ox, dy: oy, dur: 450 });
      }
      if (mine) this.ctx.sfx('click');
    } else if (p.alive && p.fall === 0 && prev > 0) {
      // made it back onto the ice
      pushFx({ k: 'ring', x, y, dur: 450, r: 90, color: 0xbfe8ff });
      if (m > 0) pushFx({ k: 'splash', x, y, dx: ox, dy: oy, dur: 500 });
      if (mine) this.ctx.sfx('hop');
    }
  }

  /** the dangling bear: water over its lower half, paws clawing the rim, bubbles and the time left as a ring */
  private drawHang(g: Phaser.GameObjects.Graphics, p: PolarPlayerState, x: number, y: number, r: number, ox: number, oy: number, heave: number, now: number, m: number, color: number): void {
    const px = -oy;
    const py = ox;
    // the waterline: the outer half of the body is under water, bluer as time runs out
    const body = ellipsePts(x, y, r, r, 0);
    const thr = (x - CENTER) * ox + (y - CENTER) * oy - r * 0.05;
    const wet = clipHalf(body, ox, oy, thr);
    if (wet.length > 2) g.fillStyle(0x2a78c8, 0.5 + 0.25 * (1 - p.drown)).fillPoints(wet, true);
    const half = Math.sqrt(Math.max(0, r * r - (r * 0.05) ** 2));
    const cx = x + ox * r * 0.05;
    const cy = y + oy * r * 0.05;
    g.lineStyle(3, 0xffffff, 0.8).lineBetween(cx - px * half, cy - py * half, cx + px * half, cy + py * half);
    // paws on the ice side, reaching further at the top of a heave
    const reach = 0.95 + heave * 0.03;
    for (const side of [-1, 1]) {
      const wx = x - ox * r * reach + px * side * r * 0.55;
      const wy = y - oy * r * reach + py * side * r * 0.55;
      g.fillStyle(color, 1).fillCircle(wx, wy, r * 0.28);
      g.lineStyle(3, 0x1b1033, 1).strokeCircle(wx, wy, r * 0.28);
      g.lineStyle(2, 0xffffff, 1);
      for (const c of [-1, 0, 1]) g.lineBetween(wx - ox * r * 0.2 + px * c * 4, wy - oy * r * 0.2 + py * c * 4, wx - ox * r * 0.42 + px * c * 5, wy - oy * r * 0.42 + py * c * 5);
    }
    // bubbles rise from the water side when time is short
    if (m > 0 && p.drown < 0.5) {
      for (let i = 0; i < 3; i++) {
        const q = (now / 700 + i / 3) % 1;
        g.fillStyle(0xffffff, 0.8 * (1 - q)).fillCircle(x + ox * r * 0.7 + px * (i - 1) * r * 0.5, y + oy * r * 0.7 - q * 30, 3);
      }
    }
    // the time left, white going red, pulsing at the end
    const urgent = p.drown < 0.3;
    const pulse = urgent && m > 0 ? 0.6 + 0.4 * Math.sin(now / 60) : 1;
    g.lineStyle(5, urgent ? 0xff4d4d : 0xffffff, 0.9 * pulse);
    g.beginPath();
    g.arc(x, y, r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.drown, false);
    g.strokePath();
  }

  private drawBear(host: RenderHost, p: PolarPlayerState, x: number, y: number, now: number): void {
    const g = host.g;
    const color = this.ctx.colorOf(p.id);
    const swimming = p.alive && p.fall > 0;
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
    const r = p.r * scale;
    const isMe = p.id === this.ctx.myId();
    // hanging on the edge: sunk towards the water, heaving up on each press
    const m = this.ctx.motion();
    const dx0 = x - CENTER;
    const dy0 = y - CENTER;
    const dl = Math.hypot(dx0, dy0) || 1;
    const ox = dx0 / dl; // outward, towards the water
    const oy = dy0 / dl;
    const heave = swimming && m > 0 ? Math.max(0, 1 - (now - (this.lastPress.get(p.id) ?? -1e9)) / 220) * 10 : 0;
    this.trackClimb(p, x, y, ox, oy, now, m);
    if (swimming) {
      const sink = (1 - p.drown) * 0.45 * r;
      const tremor = m > 0 ? Math.sin(now / 30) * (1 - p.drown) * 3 * m : 0;
      x += ox * (sink - heave) - oy * tremor;
      y += oy * (sink - heave) + ox * tremor;
      // ripples round the struggling bear
      for (let i = 0; i < 2; i++) {
        const q = m > 0 ? ((now / 900 + i / 2) % 1) : 0.4;
        g.lineStyle(3, 0xffffff, 0.55 * (1 - q)).strokeCircle(x, y, r + 6 + q * 22);
      }
    } else {
      g.fillStyle(0x000000, 0.3).fillEllipse(x + 4, y + 8 * scale, r * 2, r * 1.4);
    }
    if (p.alive && p.carry && !swimming) {
      // the one to watch: a pulsing glow in the item's colour, redder as the countdown runs out
      const pulse = this.ctx.motion() > 0 ? 0.5 + 0.5 * Math.sin(now / (p.carryl < 0.3 ? 70 : 180)) : 0.5;
      g.fillStyle(p.carry === 'weight' ? 0xff4d4d : 0xfff08a, 0.18 + 0.22 * pulse).fillCircle(x, y, r + 14 + 8 * pulse);
    }
    // bear: round body, ears, snout
    const ex = Math.cos(p.f);
    const ey = Math.sin(p.f);
    if (!(p.inv && Math.floor(now / 80) % 2 === 0)) {
      for (const side of [-1, 1]) {
        g.fillStyle(color, 1).fillCircle(x - ex * r * 0.1 - ey * r * 0.8 * side, y - ey * r * 0.1 + ex * r * 0.8 * side, r * 0.38);
      }
      g.fillStyle(color, 1).fillCircle(x, y, r);
      g.lineStyle(isMe ? 6 : 4, isMe ? 0xffffff : 0x1b1033, 1).strokeCircle(x, y, r);
      g.fillStyle(0xffffff, 1).fillCircle(x + ex * r * 0.7, y + ey * r * 0.7, r * 0.3);
      g.fillStyle(0x111111, 1).fillCircle(x + ex * r * 0.9, y + ey * r * 0.9, r * 0.12);
      for (const side of [-1, 1]) {
        const ox = x + ex * r * 0.3 - ey * r * 0.35 * side;
        const oy = y + ey * r * 0.3 + ex * r * 0.35 * side;
        g.fillStyle(0xffffff, 1).fillCircle(ox, oy, r * 0.22);
        g.fillStyle(0x111111, 1).fillCircle(ox + ex * r * 0.07, oy + ey * r * 0.07, r * 0.11);
      }
    }

    if (swimming) this.drawHang(g, p, x, y, r, ox, oy, heave, now, m, color);

    if (p.alive) {
      if (p.fx) {
        g.lineStyle(4, FX_COLOR[p.fx] ?? 0xffffff, 0.9).strokeCircle(x, y, r + 6);
        const iy = y - r - 34;
        const ix = p.carry ? x - 34 : x;
        this.drawPowerIcon(g, p.fx, ix, iy, 14);
        g.lineStyle(3, 0xffffff, 0.9);
        g.beginPath();
        g.arc(ix, iy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.fxl, false);
        g.strokePath();
      }
      if (p.stun > 0.5) {
        // stunned: sparks circling over the head
        const spin = this.ctx.motion() > 0 ? now / 250 : 0;
        for (let i = 0; i < 3; i++) {
          const a = spin + (i * Math.PI * 2) / 3;
          const sx = x + Math.cos(a) * (r * 0.7);
          const sy = y - r - 4 + Math.sin(a) * 6;
          g.fillStyle(0xfff08a, 1).fillPoints([{ x: sx, y: sy - 7 }, { x: sx + 3, y: sy - 2 }, { x: sx + 8, y: sy }, { x: sx + 3, y: sy + 2 }, { x: sx, y: sy + 7 }, { x: sx - 3, y: sy + 2 }, { x: sx - 8, y: sy }, { x: sx - 3, y: sy - 2 }], true);
        }
      }
      if (p.carry) {
        // hot potato: the ring runs down and flashes in the last seconds
        const cx = p.fx ? x + 34 : x;
        const cy = y - r - 34;
        const hurry = p.carryl < 0.3 && (this.ctx.motion() === 0 || Math.floor(now / 120) % 2 === 0);
        this.drawPowerIcon(g, p.carry, cx, cy, 14);
        g.lineStyle(4, hurry ? 0xffffff : p.carry === 'weight' ? 0xff4d4d : 0xfff08a, 1);
        g.beginPath();
        g.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.carryl, false);
        g.strokePath();
      }
      if (p.bomb) {
        g.fillStyle(0x222222, 1).fillCircle(x, y - r - 12, 11);
        g.fillStyle(0xff7a1a, 1).fillCircle(x + 6, y - r - 22, 4);
      }
      if (swimming) {
        g.fillStyle(0x000000, 0.5).fillRect(x - 24, y + r + 10, 48, 8);
        g.fillStyle(0xffd23f, 1).fillRect(x - 24, y + r + 10, 48 * Math.min(1, p.fall), 8);
      } else if (isMe) {
        // stamina ring: gold = a charge is ready
        g.lineStyle(5, p.st >= 0.5 ? 0xffd23f : 0x6fa8d6, 0.95);
        g.beginPath();
        g.arc(x, y, r + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.st, false);
        g.strokePath();
      }
    }
    host.label(p.id).setPosition(x, y - r - (p.bomb ? 30 : p.fx || p.carry ? 56 : 12)).setAlpha(scale).setVisible(true);
  }
}

/** polygon of an ellipse centred on (cx, cy), semi-axes rx (along `rot`) and ry */
function ellipsePts(cx: number, cy: number, rx: number, ry: number, rot: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  }
  return pts;
}

/** the part of a polygon around the floe's centre whose projection on (ux, uy) is at least `thr` (Sutherland-Hodgman against one line) */
function clipHalf(pts: { x: number; y: number }[], ux: number, uy: number, thr: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const f = (p: { x: number; y: number }) => (p.x - CENTER) * ux + (p.y - CENTER) * uy - thr;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const k = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
  }
  return out;
}
