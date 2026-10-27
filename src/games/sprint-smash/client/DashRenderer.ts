import type Phaser from 'phaser';
import type { ClientContext, RenderHost } from '../../../core/client/src/plugins/api';
import { DASH_CX, DASH_CY, DASH_INNER, DASH_MID, DASH_OUTER, DASH_ROD_HALF, DASH_ROD_LEN, DASH_WALL_FROM, DASH_WALL_TO } from '../shared/geometry';
import type { DashPlayerState, DashState } from '../shared/types';

const PLAYER_R = 20;
const TELEPORT = 300;
const JUMP_HEIGHT = 36;

type Scenery = { floor: number; wall: number; line: number };
const SCENERY: Record<string, Scenery> = {
  'dot-sprint': { floor: 0x3b5d8f, wall: 0x24385a, line: 0x7fa8e6 },
  'toxic-sprint': { floor: 0x4a6a2a, wall: 0x2f4219, line: 0x9cd24a },
  'ember-sprint': { floor: 0x7a4a2a, wall: 0x4a2a14, line: 0xe6a05a },
  'splash-sprint': { floor: 0x1f7fa8, wall: 0x0f4a68, line: 0x8fe0ff },
};

/** Draws Sprint Smash: the ring track, the variant scenery, pickups and hovercrafts. */
export class DashRenderer {
  /** when each craft was first seen falling (client clock): only drives the shrinking animation */
  private readonly fallSince = new Map<string, number>();

  constructor(private readonly ctx: ClientContext) {}

  reset(): void {
    this.fallSince.clear();
  }

  render(host: RenderHost, a: DashState, b: DashState, latest: DashState, alpha: number): void {
    const g = host.g;
    const sc = SCENERY[latest.variant] ?? SCENERY['dot-sprint'];
    this.drawTrack(g, sc, latest.variant === 'dot-sprint', latest.variant === 'toxic-sprint', latest.variant === 'ember-sprint', latest.variant === 'splash-sprint');
    this.drawScenery(g, latest, a, b, alpha);

    for (const k of latest.pickups) this.drawPickup(g, k);
    for (const m of latest.missiles) this.drawMissile(g, m.x, m.y, m.a);

    const aById = new Map(a.players.map((p) => [p.id, p]));
    const bById = new Map(b.players.map((p) => [p.id, p]));
    const now = performance.now();
    // far crafts first so the nearer ones overlap them
    const order = [...latest.players].sort((p, q) => p.y - q.y);
    for (const p of order) {
      const pa = aById.get(p.id) ?? p;
      const pb = bById.get(p.id) ?? p;
      const jumped = Math.hypot(pb.x - pa.x, pb.y - pa.y) > TELEPORT;
      const x = jumped ? pb.x : this.ctx.lerp(pa.x, pb.x, alpha);
      const y = jumped ? pb.y : this.ctx.lerp(pa.y, pb.y, alpha);
      this.drawCraft(host, p, x, y, now, latest.variant === 'splash-sprint', latest.variant === 'toxic-sprint' ? 'toxic' : latest.variant === 'ember-sprint' ? 'ember' : latest.variant === 'splash-sprint' ? 'sea' : '');
    }
  }

  /** `open` (Dot Sprint): a rooftop high above a city. The inner edge is a solid wall, the outer edge is a wall only on the top arc and a drop into the void elsewhere. */
  private drawTrack(g: Phaser.GameObjects.Graphics, sc: Scenery, open: boolean, toxic = false, ember = false, sea = false): void {
    if (sea) {
      this.drawSeaTrack(g, sc);
    } else if (ember) {
      this.drawEmberTrack(g, sc);
    } else if (toxic) {
      this.drawToxicTrack(g, sc);
    } else if (open) {
      this.drawVoid(g);
      // the roof slab's side face, then its top
      g.fillStyle(0x000000, 0.45).fillCircle(DASH_CX + 6, DASH_CY + 16, DASH_OUTER + 6);
      g.fillStyle(0x2a2f3d, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER + 6);
      g.fillStyle(sc.floor, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER);
      // open edge: a bright kerb with a dark drop-off line just outside it
      g.lineStyle(3, 0xcfe0ff, 0.55).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER - 2);
      g.lineStyle(5, 0x05060c, 0.7).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER + 4);
      // the inner wall: soft shadow on the floor, a raised dark base and a lit lip, then the rooftop it fences in
      g.fillStyle(0x000000, 0.3).fillCircle(DASH_CX + 3, DASH_CY + 5, DASH_INNER + 12);
      g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER + 6);
      g.fillStyle(0x9fb4d6, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER);
      g.fillStyle(0x3a4256, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER - 8);
      this.hazard(g, DASH_INNER + 3, 6);
      // the rooftop: a helipad ring and a few vents
      g.lineStyle(5, 0xd9dde8, 0.35).strokeCircle(DASH_CX, DASH_CY, 90);
      g.fillStyle(0x2a3042, 1);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        g.fillRect(DASH_CX + Math.cos(a) * 150 - 18, DASH_CY + Math.sin(a) * 150 - 12, 36, 24);
      }
      // the top outer wall: the same raised base, lip and hazard stripes as the inner one
      g.lineStyle(16, sc.wall, 1);
      g.beginPath();
      g.arc(DASH_CX, DASH_CY, DASH_OUTER + 8, DASH_WALL_FROM, DASH_WALL_TO, false);
      g.strokePath();
      g.lineStyle(4, 0x9fb4d6, 1);
      g.beginPath();
      g.arc(DASH_CX, DASH_CY, DASH_OUTER, DASH_WALL_FROM, DASH_WALL_TO, false);
      g.strokePath();
      this.hazard(g, DASH_OUTER + 9, 6, DASH_WALL_FROM, DASH_WALL_TO);
    } else {
      g.fillStyle(0x000000, 0.3).fillCircle(DASH_CX + 8, DASH_CY + 12, DASH_OUTER + 14);
      g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER + 14);
      g.fillStyle(sc.floor, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER);
      // the infield
      g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER);
      g.fillStyle(0x1b1033, 0.55).fillCircle(DASH_CX, DASH_CY, DASH_INNER - 14);
    }
    // dashed centre line
    g.lineStyle(4, sc.line, 0.6);
    const steps = 48;
    for (let i = 0; i < steps; i += 2) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2;
      g.beginPath();
      g.arc(DASH_CX, DASH_CY, DASH_MID, a0, a1, false);
      g.strokePath();
    }
    // start / finish line at angle 0
    const cells = 6;
    const w = (DASH_OUTER - DASH_INNER) / cells;
    for (let i = 0; i < cells; i++) {
      g.fillStyle(i % 2 === 0 ? 0xffffff : 0x1b1033, 0.9).fillRect(DASH_CX + DASH_INNER + i * w, DASH_CY - 7, w, 14);
    }
  }

  /** Toxic Sprint: the track is a slab in a pool of toxic green liquid; the infield is a pool too. */
  private drawToxicTrack(g: Phaser.GameObjects.Graphics, sc: Scenery): void {
    const now = performance.now();
    this.liquid(g, -300, -300, 1600, 1600, 0, 0);
    // the slab the crafts race on: an open outer edge (a kerb, then the liquid) and its shore glowing lime
    g.fillStyle(0x000000, 0.35).fillCircle(DASH_CX + 4, DASH_CY + 8, DASH_OUTER + 6);
    g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER + 5);
    g.fillStyle(sc.floor, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER);
    g.lineStyle(3, 0xcfe0ff, 0.5).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER - 2);
    g.lineStyle(7, 0x9cff3a, 0.35 + 0.15 * Math.sin(now / 500)).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER + 9);
    // the infield pool, fenced by a solid hazard-striped wall
    g.fillStyle(0x000000, 0.3).fillCircle(DASH_CX + 3, DASH_CY + 5, DASH_INNER + 12);
    g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER + 6);
    g.fillStyle(0x9fb4d6, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER);
    g.fillStyle(0x1f5a12, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER - 8);
    this.liquid(g, 0, 0, 0, 0, DASH_INNER - 10, 1);
    this.hazard(g, DASH_INNER + 3, 6);
    g.lineStyle(5, 0x9cff3a, 0.35 + 0.15 * Math.sin(now / 500 + 1)).strokeCircle(DASH_CX, DASH_CY, DASH_INNER - 8);
  }

  /** Ember Sprint: the track is a rock slab in a sea of liquid lava; the infield is the volcano's rock island. */
  private drawEmberTrack(g: Phaser.GameObjects.Graphics, sc: Scenery): void {
    const now = performance.now();
    // the lava: dark red base, a glow towards the slab, drifting hot swirls and cooling crust, bubbles and sparks
    g.fillStyle(0x2a0804, 1).fillRect(-300, -300, 1600, 1600);
    for (let i = 0; i < 6; i++) g.fillStyle(0xd23a0a, 0.1).fillCircle(DASH_CX, DASH_CY, 560 - i * 28);
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2 + now / (11000 + i * 900);
      const r = DASH_OUTER + 25 + rnd() * 330;
      const cx = DASH_CX + Math.cos(a) * r;
      const cy = DASH_CY + Math.sin(a) * r;
      g.fillStyle(0xff7a1a, 0.16 + 0.08 * Math.sin(now / 600 + i)).fillEllipse(cx, cy, 140 + rnd() * 90, 30 + rnd() * 18);
      g.fillStyle(0x1a0604, 0.55).fillEllipse(cx + 40, cy + 14, 90 + rnd() * 60, 22 + rnd() * 10); // crust plate
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const r = DASH_OUTER + 30 + rnd() * 340;
      const ph = (now / 1800 + rnd()) % 1;
      const bx = DASH_CX + Math.cos(a) * r;
      const by = DASH_CY + Math.sin(a) * r;
      g.lineStyle(2, 0xffd23f, 0.6 * (1 - ph)).strokeCircle(bx, by, 3 + ph * 9); // a bubble popping
      g.fillStyle(0xffb347, 0.7 * (1 - ph)).fillCircle(bx + Math.sin(ph * 6 + a) * 4, by - ph * 40, 1.6); // a spark rising
    }
    // the slab: open kerb with a hot glow where it meets the lava
    g.fillStyle(0xff5a1a, 0.18 + 0.06 * Math.sin(now / 400)).fillCircle(DASH_CX, DASH_CY, DASH_OUTER + 22);
    g.fillStyle(0x000000, 0.4).fillCircle(DASH_CX + 3, DASH_CY + 7, DASH_OUTER + 6);
    g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER + 5);
    g.fillStyle(sc.floor, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER);
    g.lineStyle(3, 0xffc08a, 0.5).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER - 2);
    g.lineStyle(6, 0xff7a1a, 0.5 + 0.2 * Math.sin(now / 350)).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER + 8);
    // the volcano's island, fenced by the solid hazard-striped wall
    g.fillStyle(0x000000, 0.3).fillCircle(DASH_CX + 3, DASH_CY + 5, DASH_INNER + 12);
    g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER + 6);
    g.fillStyle(0xc9b8a8, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER);
    g.fillStyle(0x3a2418, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER - 8);
    this.hazard(g, DASH_INNER + 3, 6);
  }

  /** Splash Sprint: the track is a slab in the open sea; the infield is the hub's island. */
  private drawSeaTrack(g: Phaser.GameObjects.Graphics, sc: Scenery): void {
    const now = performance.now();
    g.fillStyle(0x07304f, 1).fillRect(-300, -300, 1600, 1600);
    for (let i = 0; i < 7; i++) g.fillStyle(0x0d5a8a, 0.14).fillCircle(DASH_CX, DASH_CY, 600 - i * 45);
    // slow wave bands, foam streaks and caustic sparkles
    for (let i = 0; i < 14; i++) {
      const y = ((i * 97 + now / 60) % 1500) - 250;
      g.fillStyle(0x3aa0d8, 0.09).fillEllipse(DASH_CX + Math.sin(now / 2000 + i) * 40, y, 900, 22);
    }
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = DASH_OUTER + 20 + rnd() * 340;
      const x = DASH_CX + Math.cos(a) * r + Math.sin(now / 900 + i) * 6;
      const y = DASH_CY + Math.sin(a) * r;
      g.fillStyle(0xffffff, 0.12 + 0.12 * Math.sin(now / 500 + i * 2)).fillEllipse(x, y, 26 + rnd() * 30, 4);
      if (i % 3 === 0) g.fillStyle(0xdff6ff, 0.5 + 0.3 * Math.sin(now / 300 + i)).fillCircle(x + 10, y - 6, 1.6);
    }
    // the slab with a foamy lapping edge (open: past it is the sea)
    g.fillStyle(0xdff6ff, 0.22 + 0.1 * Math.sin(now / 450)).fillCircle(DASH_CX, DASH_CY, DASH_OUTER + 20);
    g.fillStyle(0x000000, 0.35).fillCircle(DASH_CX + 3, DASH_CY + 7, DASH_OUTER + 6);
    g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER + 5);
    g.fillStyle(sc.floor, 1).fillCircle(DASH_CX, DASH_CY, DASH_OUTER);
    g.lineStyle(3, 0xcfe0ff, 0.5).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER - 2);
    g.lineStyle(5, 0xffffff, 0.45 + 0.2 * Math.sin(now / 300)).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER + 9);
    // the hub's island, fenced by the solid hazard-striped wall
    g.fillStyle(0x000000, 0.3).fillCircle(DASH_CX + 3, DASH_CY + 5, DASH_INNER + 12);
    g.fillStyle(sc.wall, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER + 6);
    g.fillStyle(0x9fb4d6, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER);
    g.fillStyle(0x1b4a6e, 1).fillCircle(DASH_CX, DASH_CY, DASH_INNER - 8);
    this.hazard(g, DASH_INNER + 3, 6);
  }

  /** the hub: a rotating hexagonal machine with 6 ports; a port glows while its tube is out; tubes are segmented pipes */
  private drawHub(g: Phaser.GameObjects.Graphics, ra: number, tubes: number[], now: number): void {
    const n = tubes.length;
    // tubes first: the hub covers their roots
    for (let k = 0; k < n; k++) {
      const ext = tubes[k];
      if (ext <= 0) continue;
      const ang = ra + (k * Math.PI * 2) / n;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const len = DASH_ROD_LEN * ext;
      const at = (d: number, off: number) => ({ x: DASH_CX + c * d - sn * off, y: DASH_CY + sn * d + c * off });
      const quad = [at(0, -DASH_ROD_HALF), at(len, -DASH_ROD_HALF), at(len, DASH_ROD_HALF), at(0, DASH_ROD_HALF)];
      g.fillStyle(0x000000, 0.28).fillPoints(quad.map((q) => ({ x: q.x + 3, y: q.y + 7 })), true);
      g.fillStyle(ext < 0.9 ? 0xe8a23a : 0xc9d4e0, 1).fillPoints(quad, true); // amber while moving
      const hl = [at(0, -DASH_ROD_HALF * 0.55), at(len, -DASH_ROD_HALF * 0.55), at(len, -DASH_ROD_HALF * 0.2), at(0, -DASH_ROD_HALF * 0.2)];
      g.fillStyle(0xffffff, 0.55).fillPoints(hl, true);
      for (let d = 70; d < len; d += 60) {
        const f = [at(d, -DASH_ROD_HALF - 3), at(d + 8, -DASH_ROD_HALF - 3), at(d + 8, DASH_ROD_HALF + 3), at(d, DASH_ROD_HALF + 3)];
        g.fillStyle(0x4a5a6e, 1).fillPoints(f, true);
      }
      g.lineStyle(3, 0x1b2a3a, 0.9).strokePoints(quad, true);
      const tip = at(len, 0);
      g.fillStyle(0x4a5a6e, 1).fillCircle(tip.x, tip.y, DASH_ROD_HALF * 0.9);
    }
    // the hub: hexagon body with a port on each corner
    const hex = Array.from({ length: n }, (_, k) => ({ x: DASH_CX + Math.cos(ra + (k * Math.PI * 2) / n) * 74, y: DASH_CY + Math.sin(ra + (k * Math.PI * 2) / n) * 74 }));
    g.fillStyle(0x000000, 0.3).fillPoints(hex.map((q) => ({ x: q.x + 4, y: q.y + 8 })), true);
    g.fillStyle(0x56677c, 1).fillPoints(hex, true);
    g.lineStyle(4, 0x2a3646, 1).strokePoints(hex, true);
    g.fillStyle(0x3b4a5e, 1).fillCircle(DASH_CX, DASH_CY, 40);
    g.lineStyle(3, 0x9fb4d6, 0.7).strokeCircle(DASH_CX, DASH_CY, 40);
    for (let k = 0; k < n; k++) {
      const a = ra + (k * Math.PI * 2) / n;
      const px = DASH_CX + Math.cos(a) * 62;
      const py = DASH_CY + Math.sin(a) * 62;
      const lit = tubes[k] > 0;
      const warn = lit && tubes[k] < 1 ? 0.6 + 0.4 * Math.sin(now / 60) : 1;
      g.fillStyle(0x10161f, 1).fillCircle(px, py, 13);
      g.fillStyle(lit ? 0xffb347 : 0x4a5a6e, lit ? warn : 1).fillCircle(px, py, 9);
      g.lineStyle(2, 0xdde6f0, 0.8).strokeCircle(px, py, 13);
    }
  }

  /** green liquid: swirls and rising bubbles, over the whole rect (rad 0) or inside a circle of radius `rad` */
  private liquid(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, rad: number, seedOff: number): void {
    const now = performance.now();
    if (rad === 0) {
      g.fillStyle(0x0d2a0a, 1).fillRect(x, y, w, h);
      for (let i = 0; i < 6; i++) g.fillStyle(0x17441a, 0.18).fillCircle(DASH_CX, DASH_CY, 760 - i * 60);
    }
    let seed = 777 + seedOff * 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 1000) / 1000;
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2 + now / (9000 + i * 700);
      const r = rad ? rnd() * (rad - 40) : DASH_OUTER + 40 + rnd() * 330;
      g.fillStyle(0x4fbf2a, 0.1).fillEllipse(DASH_CX + Math.cos(a) * r, DASH_CY + Math.sin(a) * r, 120 + rnd() * 80, 28 + rnd() * 16);
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rad ? rnd() * (rad - 30) : DASH_OUTER + 30 + rnd() * 340;
      const ph = (now / 2400 + rnd()) % 1;
      g.fillStyle(0xc8ff7a, 0.5 * (1 - ph)).fillCircle(DASH_CX + Math.cos(a) * r, DASH_CY + Math.sin(a) * r - ph * 18, 2 + rnd() * 3 * ph + 1);
    }
  }

  /** yellow / black warning stripes along an arc (default: the whole circle) */
  private hazard(g: Phaser.GameObjects.Graphics, r: number, w: number, from = 0, to = Math.PI * 2): void {
    const n = Math.max(2, Math.round(((to - from) * r) / 18));
    const da = (to - from) / n;
    for (let i = 0; i < n; i++) {
      g.lineStyle(w, i % 2 === 0 ? 0xf2c230 : 0x14161c, 1);
      g.beginPath();
      g.arc(DASH_CX, DASH_CY, r, from + i * da, from + (i + 1) * da, false);
      g.strokePath();
    }
  }

  /** What is outside the roof: a dark drop with the lights of a city far below and clouds drifting through it. */
  private drawVoid(g: Phaser.GameObjects.Graphics): void {
    const now = performance.now();
    g.fillStyle(0x060a18, 1).fillRect(-300, -300, 1600, 1600);
    // depth: rings getting darker towards the roof's edge
    for (let i = 0; i < 6; i++) g.fillStyle(0x0c1530, 0.16).fillCircle(DASH_CX, DASH_CY, 760 - i * 55);
    // the city far below: fixed pseudo-random lights that twinkle
    let seed = 12345;
    for (let i = 0; i < 70; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const a = (seed % 6283) / 1000;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const r = DASH_OUTER + 30 + (seed % 330);
      const tw = 0.35 + 0.35 * Math.sin(now / 700 + i * 1.7);
      g.fillStyle(i % 5 === 0 ? 0xffc46b : 0x9fd0ff, tw).fillCircle(DASH_CX + Math.cos(a) * r, DASH_CY + Math.sin(a) * r, 1.6 + (i % 3));
    }
    // clouds drifting past, below the roof
    for (let i = 0; i < 5; i++) {
      const x = ((now / 90 + i * 330) % 1500) - 250;
      const y = 80 + ((i * 197) % 880);
      g.fillStyle(0xaec4e8, 0.07).fillEllipse(x, y, 260, 46);
      g.fillStyle(0xaec4e8, 0.05).fillEllipse(x + 60, y + 18, 190, 34);
    }
    // the roof's drop-off glows faintly where it meets the dark
    g.lineStyle(26, 0x05060c, 0.35).strokeCircle(DASH_CX, DASH_CY, DASH_OUTER + 24);
  }

  private drawScenery(g: Phaser.GameObjects.Graphics, s: DashState, a: DashState, b: DashState, alpha: number): void {
    const now = performance.now();
    if (s.volcano) this.drawVolcano(g, s.volcano.warn, s.balls ?? [], now);
    for (const b of s.balls ?? []) this.drawBall(g, b, now);

    if (s.slime) {
      const k = s.slime.t;
      const r = 40 + k * 55;
      g.fillStyle(0x3a8a2a, 0.35 + 0.6 * Math.min(1, k * 2)).fillCircle(DASH_CX, DASH_CY, r);
      if (k > 0) {
        g.fillStyle(0x9cff6a, 0.8).fillCircle(DASH_CX - r * 0.3, DASH_CY - r * 0.2, r * 0.14);
        g.fillCircle(DASH_CX + r * 0.3, DASH_CY - r * 0.2, r * 0.14);
      }
    }
    for (const bl of s.blobs ?? []) {
      g.fillStyle(0x000000, 0.25).fillEllipse(bl.x + 3, bl.y + 8, 34, 14);
      g.fillStyle(0x7fe04a, 1).fillCircle(bl.x, bl.y - 6, 20);
      g.fillStyle(0xffffff, 0.8).fillCircle(bl.x - 6, bl.y - 12, 5);
    }
    for (const br of s.barrels ?? []) {
      if (!br.on) continue;
      g.fillStyle(0x000000, 0.3).fillEllipse(br.x + 3, br.y + 10, 40, 16);
      // rusty brown drum: oxide patches, two metal hoops, a toxic trefoil stamped on it
      g.fillStyle(0x7a4a2a, 1).fillRoundedRect(br.x - 18, br.y - 22, 36, 44, 8);
      g.fillStyle(0x5a3018, 0.8).fillRect(br.x - 15, br.y - 20, 9, 7).fillRect(br.x + 6, br.y + 8, 10, 8).fillRect(br.x - 16, br.y + 12, 6, 6);
      g.fillStyle(0xa8642e, 0.7).fillRect(br.x + 5, br.y - 19, 8, 5);
      g.fillStyle(0x3a2a20, 1).fillRect(br.x - 18, br.y - 16, 36, 3).fillRect(br.x - 18, br.y + 13, 36, 3);
      this.trefoil(g, br.x, br.y - 1, 9);
      g.lineStyle(3, 0x2b160a, 1).strokeRoundedRect(br.x - 18, br.y - 22, 36, 44, 8);
    }

    if (s.rods) this.drawHub(g, this.ctx.lerp(a.rods?.a ?? s.rods.a, b.rods?.a ?? s.rods.a, alpha), s.rods.tubes, now);
  }

  /** the toxic (biohazard) trefoil: three blades round a hub, stamped in warning yellow */
  private trefoil(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    g.fillStyle(0xf2c230, 0.95);
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
      g.fillCircle(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55);
    }
    g.fillStyle(0x7a4a2a, 1).fillCircle(x, y, r * 0.3);
    g.lineStyle(1.5, 0xf2c230, 0.95).strokeCircle(x, y, r * 0.3);
    g.lineStyle(2, 0xf2c230, 0.95).strokeCircle(x, y, r * 1.15);
  }

  /** the volcano on its island: a cone with glowing veins and crater, smoke, and a pulse and shake before it erupts */
  private drawVolcano(g: Phaser.GameObjects.Graphics, warn: number, balls: NonNullable<DashState['balls']>, now: number): void {
    const shake = warn > 0 ? Math.sin(now / 35) * 3 * (1.2 - warn) : 0;
    const cx = DASH_CX + shake;
    const cy = DASH_CY;
    g.fillStyle(0x000000, 0.35).fillEllipse(cx + 8, cy + 14, 250, 150);
    g.fillStyle(0x4a2a1a, 1).fillCircle(cx, cy, 130);
    g.fillStyle(0x5e3822, 1).fillCircle(cx, cy, 105);
    g.fillStyle(0x7a4a2e, 1).fillCircle(cx, cy, 78);
    // lava veins down the cone
    for (let k = 0; k < 7; k++) {
      const a = (k * Math.PI * 2) / 7 + 0.3;
      g.lineStyle(4, 0xff7a1a, 0.7 + 0.3 * Math.sin(now / 300 + k)).lineBetween(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38, cx + Math.cos(a + 0.12) * 118, cy + Math.sin(a + 0.12) * 118);
    }
    // the crater: it glows and swells as the eruption nears; a flash when it has just thrown a ball
    const fresh = balls.some((b) => Math.hypot(b.x - DASH_CX, b.y - DASH_CY) < 70);
    const pulse = warn > 0 ? Math.sin(now / 60) * 6 : Math.sin(now / 400) * 2;
    g.fillStyle(0x2a0804, 1).fillCircle(cx, cy, 52);
    g.fillStyle(warn > 0 || fresh ? 0xffd23f : 0xff6a1a, 1).fillCircle(cx, cy, 40 + pulse + (fresh ? 8 : 0));
    g.fillStyle(0xffe9a0, 0.9).fillCircle(cx, cy, 20 + pulse * 0.5);
    if (warn > 0) g.lineStyle(6, 0xffd23f, 0.7).strokeCircle(cx, cy, 134 + (1 - warn) * 20);
    // smoke drifting up (screen up) from the crater
    for (let k = 0; k < 5; k++) {
      const ph = (now / 2600 + k / 5) % 1;
      g.fillStyle(0x6a6a72, 0.38 * (1 - ph)).fillCircle(cx + Math.sin(ph * 5 + k) * 14, cy - 20 - ph * 130, 16 + ph * 30);
    }
    // a fountain of sparks while it launches
    if (fresh || warn > 0) {
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + (k - 3.5) * 0.28 + Math.sin(now / 90 + k) * 0.1;
        const d = 30 + ((now / 5 + k * 17) % 60);
        g.fillStyle(0xffb347, 0.8).fillCircle(cx + Math.cos(a) * d, cy + Math.sin(a) * d - 10, 2.5);
      }
    }
  }

  /** a lava ball in the air: ground shadow, the ball lifted on an arc over its flight, glowing core, halo and a trail */
  private drawBall(g: Phaser.GameObjects.Graphics, b: NonNullable<DashState['balls']>[number], now: number): void {
    const d = Math.hypot(b.x - DASH_CX, b.y - DASH_CY);
    const k = Math.min(1, d / (DASH_OUTER + 30));
    const lift = Math.sin(Math.PI * k) * 46;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    g.fillStyle(0x000000, 0.3).fillEllipse(b.x + 3, b.y + 6, 30 * (1 - lift / 120), 12);
    for (let t = 3; t >= 1; t--) g.fillStyle(0xff5a1a, 0.18 * (4 - t)).fillCircle(b.x - (b.vx / sp) * t * 13, b.y - lift - (b.vy / sp) * t * 13, 15 - t * 2);
    g.fillStyle(0xff7a1a, 0.35 + 0.1 * Math.sin(now / 80)).fillCircle(b.x, b.y - lift, 26);
    g.fillStyle(0xff4a0a, 1).fillCircle(b.x, b.y - lift, 18);
    g.fillStyle(0xffd23f, 1).fillCircle(b.x - 3, b.y - lift - 3, 10);
    g.fillStyle(0xffffff, 0.8).fillCircle(b.x - 5, b.y - lift - 6, 3.5);
  }

  private drawPickup(g: Phaser.GameObjects.Graphics, k: DashState['pickups'][number]): void {
    const bob = Math.sin(performance.now() / 200 + k.id) * 3;
    g.fillStyle(0x000000, 0.25).fillEllipse(k.x + 2, k.y + 10, 24, 10);
    if (k.k === 'fruit') {
      g.fillStyle(0xff8a1a, 1).fillCircle(k.x, k.y + bob, 12);
      g.fillStyle(0x4aa83a, 1).fillCircle(k.x + 5, k.y - 11 + bob, 5);
    } else if (k.k === 'missile') {
      g.fillStyle(0xdddddd, 1).fillRoundedRect(k.x - 16, k.y - 7 + bob, 32, 14, 6);
      g.fillStyle(0xff3b3b, 1).fillTriangle(k.x + 16, k.y - 7 + bob, k.x + 28, k.y + bob, k.x + 16, k.y + 7 + bob);
    } else {
      this.drawField(g, k.x, k.y + bob, 14, performance.now());
    }
  }

  /** the force field: a glowing ring with sparks turning round it */
  private drawField(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, now: number): void {
    g.fillStyle(0x7bff7b, 0.25).fillCircle(x, y, r);
    g.lineStyle(3, 0xd8ffd8, 0.95).strokeCircle(x, y, r);
    for (let k = 0; k < 4; k++) {
      const a = now / 400 + (k * Math.PI) / 2;
      g.fillStyle(0xffffff, 1).fillCircle(x + Math.cos(a) * r * 1.25, y + Math.sin(a) * r * 1.25, Math.max(1.5, r * 0.18));
    }
    g.fillStyle(0xeaffea, 1).fillCircle(x, y, r * 0.3);
  }

  /** a small icon above a craft that holds an item, so everyone can see it: a rocket or a force field */
  private drawItemIcon(g: Phaser.GameObjects.Graphics, item: 'missile' | 'star', x: number, y: number, now: number): void {
    g.fillStyle(0x10121c, 0.8).fillCircle(x, y, 12);
    if (item === 'missile') {
      g.fillStyle(0xdddddd, 1).fillRoundedRect(x - 8, y - 3, 12, 6, 3);
      g.fillStyle(0xff3b3b, 1).fillTriangle(x + 4, y - 3.5, x + 10, y, x + 4, y + 3.5);
      g.fillStyle(0xff8a1a, 1).fillTriangle(x - 8, y - 3, x - 12, y - 6, x - 6, y).fillTriangle(x - 8, y + 3, x - 12, y + 6, x - 6, y);
    } else {
      this.drawField(g, x, y, 6, now);
    }
    g.lineStyle(1.5, 0xffffff, 0.8).strokeCircle(x, y, 12);
  }

  private drawMissile(g: Phaser.GameObjects.Graphics, x: number, y: number, a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const p = (lx: number, ly: number) => ({ x: x + lx * c - ly * s, y: y + lx * s + ly * c });
    const nose = p(18, 0);
    const l = p(-12, -8);
    const r = p(-12, 8);
    g.fillStyle(0xff3b3b, 1).fillTriangle(nose.x, nose.y, l.x, l.y, r.x, r.y);
    g.fillStyle(0xffd23f, 0.8).fillCircle(p(-16, 0).x, p(-16, 0).y, 6);
  }

  private drawCraft(host: RenderHost, p: DashPlayerState, x: number, y: number, now: number, sea: boolean, liquid: '' | 'toxic' | 'ember' | 'sea' = ''): void {
    const g = host.g;
    const color = this.ctx.colorOf(p.id);
    const isMe = p.id === this.ctx.myId();
    const lift = Math.sin(Math.PI * p.air) * JUMP_HEIGHT;
    const wob = p.stun ? Math.sin(now / 40) * 3 : 0;

    if (p.fall) {
      // fallen off the roof: it shrinks into the dark, then is put back
      const since = this.fallSince.get(p.id) ?? now;
      this.fallSince.set(p.id, since);
      const k = Math.max(0.12, 1 - (now - since) / 700);
      if (liquid) g.lineStyle(3, liquid === 'toxic' ? 0xc8ff7a : liquid === 'sea' ? 0xdff6ff : 0xffb347, 0.6 * k).strokeCircle(x, y, PLAYER_R * (2.2 - k));
      g.fillStyle(liquid === 'toxic' ? 0x6bbf3a : liquid === 'ember' ? 0xd2420a : liquid === 'sea' ? 0x2a7fb8 : color, 0.8 * k).fillCircle(x, y + (1 - k) * 40, PLAYER_R * 1.05 * k);
      host.label(p.id).setPosition(x, y - PLAYER_R - 12).setVisible(k > 0.3);
      return;
    }
    this.fallSince.delete(p.id);

    g.fillStyle(0x000000, 0.3).fillEllipse(x + 4, y + 10, PLAYER_R * 2.4 * (1 - lift / 150), PLAYER_R * 1.2);
    // hull: a hovercraft, or a sea creature in Splash Sprint, pointing where it heads
    const c = Math.cos(p.f);
    const s = Math.sin(p.f);
    const pt = (lx: number, ly: number) => ({ x: x + wob + lx * c - ly * s, y: y - lift + lx * s + ly * c });
    const nose = pt(PLAYER_R * 1.5, 0);
    const bl = pt(-PLAYER_R * 1.1, -PLAYER_R * 0.95);
    const br = pt(-PLAYER_R * 1.1, PLAYER_R * 0.95);
    g.fillStyle(sea ? 0xff9ad0 : 0xdde4f0, 1).fillTriangle(nose.x, nose.y, bl.x, bl.y, br.x, br.y);
    g.fillStyle(p.slow ? 0x555b66 : color, 1).fillCircle(x + wob, y - lift, PLAYER_R * 1.05);
    if (p.slow) {
      // crawling after a hit: smoke puffs trailing behind
      for (let k = 0; k < 3; k++) {
        const ph = ((now / 500 + k / 3) % 1);
        const tail = pt(-PLAYER_R * (1.4 + ph * 1.6), Math.sin(now / 150 + k * 2) * 4);
        g.fillStyle(0x9aa0aa, 0.5 * (1 - ph)).fillCircle(tail.x, tail.y, 5 + ph * 6);
      }
    }
    if (p.boost) {
      const tail = pt(-PLAYER_R * 1.6, 0);
      g.fillStyle(0xffd23f, 0.9).fillCircle(tail.x, tail.y, 9);
    }
    if (!(p.inv && Math.floor(now / 80) % 2 === 0)) this.ctx.drawCharacter(g, p.id, x + wob, y - lift, PLAYER_R * 0.8, p.f);

    if (isMe && !p.fin) {
      // energy gauge ring
      g.lineStyle(5, p.e > 0.25 ? 0x7bff7b : 0xff7a1a, 0.9);
      g.beginPath();
      g.arc(x, y - lift, PLAYER_R + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.e, false);
      g.strokePath();
    }
    if (p.item) this.drawItemIcon(g, p.item, x, y - lift - PLAYER_R - 36, now);
    host.label(p.id).setPosition(x, y - lift - PLAYER_R - 12).setVisible(true);
  }
}
