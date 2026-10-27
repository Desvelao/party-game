import type Phaser from 'phaser';
import type { GameState } from '../../../core/shared/types';
import { WORLD_SIZE } from '../../../core/shared/constants';
import type { ClientContext, RenderHost } from '../../../core/client/src/plugins/api';
import { LOGS_FINISH_Y, LOGS_LEFT, LOGS_RIGHT, LOGS_START_Y } from '../shared/geometry';
import type { LogsPlayerState, LogsState } from '../shared/types';

const PLAYER_R = 22;
/** a jump this big between two snapshots is a restart at the start bank: no gliding across the river */
const TELEPORT = 300;
const HOP_HEIGHT = 34;
/** matches JET_RADIUS on the server */
const JET_RADIUS = 80;
const STRIPE = 40;

/** Draws Crazy Logs: river, banks, spinning logs, hopping players and the fish they carry. */
export class CrazyLogsRenderer {
  constructor(private readonly ctx: ClientContext) {}

  /** label text last set per player, to touch the Phaser text only when it changes */
  private labelText = new Map<string, string>();

  reset(): void {
    this.labelText.clear();
  }

  render(host: RenderHost, as: GameState, bs: GameState, latestState: GameState, alpha: number): void {
    const [a, b, latest] = [as, bs, latestState] as LogsState[];
    const g = host.g;
    this.drawRiver(g, latest);

    const aById = new Map(a.players.map((p) => [p.id, p]));
    const bById = new Map(b.players.map((p) => [p.id, p]));
    const now = performance.now();
    this.drawJets(g, latest);
    // far players first so nearer ones overlap them
    const order = [...latest.players].sort((p, q) => p.y - q.y);
    for (const p of order) {
      const pa = aById.get(p.id) ?? p;
      const pb = bById.get(p.id) ?? p;
      const jumped = Math.hypot(pb.x - pa.x, pb.y - pa.y) > TELEPORT;
      const x = jumped ? pb.x : this.ctx.lerp(pa.x, pb.x, alpha);
      const y = jumped ? pb.y : this.ctx.lerp(pa.y, pb.y, alpha);
      const h = jumped ? pb.h : this.ctx.lerp(pa.h, pb.h, alpha);
      this.drawPlayer(host, p, x, y, h, now);
    }
  }

  private drawRiver(g: Phaser.GameObjects.Graphics, s: LogsState): void {
    // water
    g.fillStyle(0x1f6fb2, 1).fillRect(0, LOGS_FINISH_Y, WORLD_SIZE, LOGS_START_Y - LOGS_FINISH_Y);
    g.lineStyle(3, 0x4aa3e0, 0.45);
    for (let y = LOGS_FINISH_Y + 20; y < LOGS_START_Y; y += 50) g.lineBetween(0, y, WORLD_SIZE, y);
    // banks
    g.fillStyle(0x4f8f3a, 1).fillRect(0, 0, WORLD_SIZE, LOGS_FINISH_Y);
    g.fillStyle(0x3a7a2a, 1).fillRect(0, LOGS_FINISH_Y - 10, WORLD_SIZE, 10);
    g.fillStyle(0x4f8f3a, 1).fillRect(0, LOGS_START_Y, WORLD_SIZE, WORLD_SIZE - LOGS_START_Y);
    g.fillStyle(0x3a7a2a, 1).fillRect(0, LOGS_START_Y, WORLD_SIZE, 10);
    // finish line
    g.fillStyle(0xffffff, 0.9);
    for (let x = 0; x < WORLD_SIZE; x += 40) g.fillRect(x, LOGS_FINISH_Y - 22, 20, 12);

    const HALF = s.half;
    for (const row of s.rows) {
      const cy = row.y;
      const w = LOGS_RIGHT - LOGS_LEFT;
      g.fillStyle(0x000000, 0.25).fillRoundedRect(LOGS_LEFT + 4, cy - HALF + 8, w, HALF * 2, 18);
      g.fillStyle(0x8a5a2b, 1).fillRoundedRect(LOGS_LEFT, cy - HALF, w, HALF * 2, 18);
      // a cylinder seen from above: lit along its axis, darker towards both sides
      g.fillStyle(0xa87238, 1).fillRoundedRect(LOGS_LEFT, cy - HALF * 0.6, w, HALF * 1.2, 12);
      g.fillStyle(0xc28a48, 1).fillRoundedRect(LOGS_LEFT + 6, cy - HALF * 0.25, w - 12, HALF * 0.5, 6);
      // the bark bands travel across the log (along y) with its surface, so the spin is readable
      const v = row ? row.v : 0;
      const off = row ? ((row.ph % STRIPE) + STRIPE) % STRIPE : 0;
      g.lineStyle(5, 0x5e3a18, 0.8);
      for (let k = -1; k < 2; k++) {
        const y = cy - HALF + off + k * STRIPE;
        if (y < cy - HALF + 5 || y > cy + HALF - 5) continue;
        g.lineBetween(LOGS_LEFT + 10, y, LOGS_RIGHT - 10, y);
      }
      // chevrons on both ends showing which way the surface (and a rider) is dragged
      if (Math.abs(v) > 8) {
        const dir = v > 0 ? 1 : -1; // +1 = screen down, towards the start bank
        g.fillStyle(0xffd23f, Math.min(1, 0.35 + Math.abs(v) / 200));
        for (const ax of [LOGS_LEFT + 28, LOGS_RIGHT - 28]) {
          g.fillTriangle(ax, cy + dir * 12, ax - 11, cy - dir * 8, ax + 11, cy - dir * 8);
        }
      }
    }
  }

  /** Warning ring while a jet charges, then a plume of water for a moment. */
  private drawJets(g: Phaser.GameObjects.Graphics, s: LogsState): void {
    const now = performance.now();
    for (const j of s.jets) {
      if (!j.e) {
        const pulse = 0.6 + 0.4 * Math.sin(now / 70);
        g.lineStyle(5, 0xffffff, 0.45 + 0.4 * pulse).strokeCircle(j.x, j.y, JET_RADIUS * (1 - j.w * 0.5));
        g.fillStyle(0xbfe8ff, 0.25 + 0.3 * (1 - j.w)).fillCircle(j.x, j.y, JET_RADIUS * 0.5 * (1 - j.w * 0.4));
      } else {
        g.fillStyle(0xbfe8ff, 0.55).fillCircle(j.x, j.y, JET_RADIUS);
        for (let k = 0; k < 4; k++) {
          const h = 50 + k * 28 + Math.sin(now / 50 + k) * 8;
          g.fillStyle(0xffffff, 0.85 - k * 0.15).fillEllipse(j.x, j.y - h * 0.6, 44 - k * 8, h);
        }
      }
    }
  }

  private drawPlayer(host: RenderHost, p: LogsPlayerState, x: number, y: number, h: number, now: number): void {
    const g = host.g;
    const label = host.label(p.id);
    if (!p.alive) {
      label.setVisible(false);
      return;
    }
    const color = this.ctx.colorOf(p.id);
    const sinking = p.w > 0;
    const scale = sinking ? Math.max(0.15, p.w) : 1;
    const r = PLAYER_R * scale;
    const isMe = p.id === this.ctx.myId();
    const lift = sinking ? 0 : Math.sin(Math.PI * h) * HOP_HEIGHT;
    g.fillStyle(0x000000, 0.3).fillEllipse(x + 4, y + 8 * scale, r * 2 * (1 - lift / 120), r * 1.4);
    this.ctx.drawCharacter(g, p.id, x, y - lift, r, p.f);
    this.drawFish(g, x + PLAYER_R + 6, y - lift - 4, color, now, sinking, p.id);
    if (!sinking && isMe) {
      g.lineStyle(5, p.d >= 1 ? 0xffd23f : 0x9d82ff, 0.9);
      g.beginPath();
      g.arc(x, y - lift, r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.d, false);
      g.strokePath();
    }
    const text = `${this.ctx.labelOf(p.id)} · ${p.score}`;
    if (this.labelText.get(p.id) !== text) {
      this.labelText.set(p.id, text);
      label.setText(text);
    }
    label.setPosition(x, y - lift - r - 10).setAlpha(sinking ? scale : 1).setVisible(true);
  }

  /** The player's fish, held beside them: bobs while carried and flops on its side when they are in the water. */
  private drawFish(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, now: number, flop: boolean, id: string): void {
    const seed = id.length * 1.7;
    const bob = Math.sin(now / 220 + seed) * (flop ? 5 : 3);
    const tilt = flop ? Math.sin(now / 90 + seed) * 0.5 : -0.35;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const pt = (lx: number, ly: number) => ({ x: x + lx * cos - ly * sin, y: y + bob + lx * sin + ly * cos });
    const body = pt(0, 0);
    g.fillStyle(0x000000, 0.25).fillEllipse(body.x + 3, body.y + 8, 30, 12);
    const tail = [pt(-12, 0), pt(-24, -9), pt(-24, 9)];
    g.fillStyle(color, 1).fillTriangle(tail[0].x, tail[0].y, tail[1].x, tail[1].y, tail[2].x, tail[2].y);
    g.fillStyle(color, 1).fillEllipse(body.x, body.y, 32, 18);
    g.lineStyle(2, 0x1b1033, 0.9).strokeEllipse(body.x, body.y, 32, 18);
    g.fillStyle(0xffffff, 0.55).fillEllipse(pt(1, 3).x, pt(1, 3).y, 18, 6);
    const eye = pt(9, -2);
    g.fillStyle(0xffffff, 1).fillCircle(eye.x, eye.y, 3.2);
    g.fillStyle(0x1b1033, 1).fillCircle(eye.x + 0.8, eye.y, 1.6);
  }
}
