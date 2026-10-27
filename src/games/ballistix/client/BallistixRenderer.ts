import { CORNER_SIZE, cornerCenter, fieldCorner, rotQuarter } from '../shared/geometry';
import { type BallArenaState } from '../shared/types';
import type { ClientContext, RenderHost } from '../../../core/client/src/plugins/api';
import { C, H, T, makeFrame, type Frame } from './frame';
import { fillSectorInField, strokeArcInField } from './clip';
import { paletteFor } from './palette';
import { BALLISTIX_VIEWS } from './views';

/**
 * Draws the core Ballistix field: arena, goals, corner launchers, paddles and
 * balls. Variant features are drawn by the registered views (`BALLISTIX_VIEWS`);
 * this file knows nothing about any specific variant.
 */
export class BallistixRenderer {
  constructor(private readonly ctx: ClientContext) {}

  /** the side the local player owns; spectators keep the last/default orientation */
  private viewerSide = 0;

  render(host: RenderHost, a: BallArenaState, b: BallArenaState, s: BallArenaState, alpha: number): void {
    const me = s.paddles.find((p) => p.id === this.ctx.myId());
    if (me) this.viewerSide = me.side;
    const motion = this.ctx.motion();
    const turn = (4 - this.viewerSide) % 4;
    let warp = null;
    for (const v of BALLISTIX_VIEWS) {
      warp = v.warp?.(s, a, b, alpha, performance.now(), turn, motion) ?? null;
      if (warp) break;
    }
    const f = makeFrame(host, a, b, s, alpha, this.viewerSide, warp, motion);

    for (const v of BALLISTIX_VIEWS) v.backdrop?.(f);
    this.drawField(f);
    this.drawGoals(f);
    this.drawCorners(f);
    for (const v of BALLISTIX_VIEWS) v.world?.(f);
    this.drawPaddles(f);
    this.drawBalls(f);
  }

  private drawField(f: Frame): void {
    const { g, warp } = f;
    const pal = paletteFor(f.s.variant);
    const corners = [f.W(C - H, C - H), f.W(C + H, C - H), f.W(C + H, C + H), f.W(C - H, C + H)].map(([x, y]) => ({ x, y }));
    if (warp) {
      // floating: the shadow stays on the ground below (it widens when the deck rises) and the deck shows its edge
      const gap = 12 + warp.lift;
      const ground = [f.W0(C - H, C - H), f.W0(C + H, C - H), f.W0(C + H, C + H), f.W0(C - H, C + H)].map(([x, y]) => ({ x: x + 8, y: y + 26 + gap }));
      g.fillStyle(0x000000, 0.28 - warp.lift * 0.01).fillPoints(ground, true);
      g.fillStyle(pal.deck, 1).fillPoints(corners.map((p) => ({ x: p.x, y: p.y + 12 })), true);
    } else {
      g.fillStyle(0x000000, 0.35).fillRect(C - H + 8, C - H + 12, 2 * H, 2 * H);
    }
    g.fillStyle(pal.surface, 1).fillPoints(corners, true);
    g.lineStyle(4, pal.lines, pal.linesAlpha);
    const [lx, ly] = f.W(C - H, C);
    const [rx, ry] = f.W(C + H, C);
    const [tx, ty] = f.W(C, C - H);
    const [bx, by] = f.W(C, C + H);
    const [cx, cy] = f.W(C, C);
    g.lineBetween(lx, ly, rx, ry).lineBetween(tx, ty, bx, by).strokeCircle(cx, cy, 90);
    if (warp) {
      // a dropped corner is shaded: it falls away from the light
      const mid = [f.W(C, C - H), f.W(C + H, C), f.W(C, C + H), f.W(C - H, C)];
      for (let k = 0; k < 4; k++) {
        const d = warp.drop[k];
        if (d < 0.02) continue;
        const prev = mid[(k + 3) % 4];
        const next = mid[k];
        // nested quads fading towards the middle: a soft edge without a gradient
        for (const q of [1, 0.7, 0.4]) {
          const lerpTo = (px: number, py: number) => ({ x: corners[k].x + (px - corners[k].x) * q, y: corners[k].y + (py - corners[k].y) * q });
          g.fillStyle(pal.shade, 0.14 * d).fillPoints([corners[k], lerpTo(next[0], next[1]), lerpTo(cx, cy), lerpTo(prev[0], prev[1])], true);
        }
      }
    }
    g.lineStyle(10, pal.border, 1).strokePoints(corners, true);
  }

  /** Goals: owner colour while alive, grey once closed; lives as pips. */
  private drawGoals(f: Frame): void {
    const { g, s, S } = f;
    for (const sd of s.sides) {
      if (!sd.used) continue;
      const owner = s.paddles.find((p) => p.side === sd.side);
      const color = sd.alive && owner ? this.ctx.colorOf(owner.id) : 0x444455;
      const L = H - CORNER_SIZE; // goals end where the corner launchers begin
      const pts = [S(sd.side, -L, H - 4), S(sd.side, L, H - 4), S(sd.side, L, H + 8), S(sd.side, -L, H + 8)].map(([x, y]) => ({ x, y }));
      g.fillStyle(color, 1).fillPoints(pts, true);
      if (sd.alive) {
        for (let i = 0; i < sd.maxLives; i++) {
          const [px, py] = S(sd.side, (i - (sd.maxLives - 1) / 2) * 26, H - 50);
          g.fillStyle(i < sd.lives ? color : 0x2c1b52, i < sd.lives ? 0.9 : 0.6).fillCircle(px, py, 8);
        }
      }
    }
  }

  /** Corner launchers: quarter discs, walls and never part of a goal. A view may replace the barrel. */
  private drawCorners(f: Frame): void {
    const { g, s } = f;
    const pal = paletteFor(s.variant);
    const charging = new Set(s.balls.filter((b) => b.wait && b.corner >= 0).map((b) => b.corner));
    const half = CORNER_SIZE * 0.375; // size hint for the variant views, which draw inside the arc
    for (let i = 0; i < 4; i++) {
      const [kx, ky] = f.W(...fieldCorner(i));
      const toward = Math.atan2(C - ky, C - kx);
      const a0 = toward - Math.PI / 4;
      const a1 = toward + Math.PI / 4;
      const disc = (ox: number, oy: number) => g.beginPath().moveTo(kx + ox, ky + oy).arc(kx + ox, ky + oy, CORNER_SIZE, a0, a1, false).closePath();
      disc(5, 7);
      g.fillStyle(0x000000, 0.3).fillPath();
      disc(0, 0);
      g.fillStyle(pal.deck, 1).fillPath();
      g.lineStyle(4, charging.has(i) ? 0xffd23f : pal.lines, 1).strokePath();
      const [wx, wy] = cornerCenter(i);
      // the launcher block is part of the deck; an engine under it is fixed in the air
      const [x, y] = f.W(wx, wy);
      const [ex, ey] = f.W0(wx, wy);
      if (BALLISTIX_VIEWS.some((v) => v.corner?.(f, i, ex, ey, half, x, y))) continue;
      // plain launcher: a barrel pointing at the field centre
      const dxs = Math.sign(C - x);
      const dys = Math.sign(C - y);
      g.lineStyle(14, charging.has(i) ? 0xffd23f : 0x6a55b8, 1).lineBetween(x, y, x + dxs * half * 1.1, y + dys * half * 1.1);
    }
  }

  private drawPaddles(f: Frame): void {
    const { g, s, a, b, alpha, S, now, host } = f;
    const aPad = new Map(a.paddles.map((p) => [p.id, p]));
    const bPad = new Map(b.paddles.map((p) => [p.id, p]));
    for (const p of s.paddles) {
      const label = host.label(p.id);
      if (!p.alive) {
        label.setVisible(false);
        continue;
      }
      const pa = aPad.get(p.id) ?? p;
      const pb = bPad.get(p.id) ?? p;
      const pos = this.ctx.lerp(pa.pos, pb.pos, alpha);
      const hl = p.len / 2;
      const pts = [S(p.side, pos - hl, H - T), S(p.side, pos + hl, H - T), S(p.side, pos + hl, H), S(p.side, pos - hl, H)].map(([x, y]) => ({ x, y }));
      const color = this.ctx.colorOf(p.id);
      const [fx, fy] = S(p.side, pos, H - T / 2);
      // direction into the field (screen space); the pulse is a half disc on that side only
      const [ix, iy] = S(p.side, pos, H - T / 2 - 1);
      const into = Math.atan2(iy - fy, ix - fx);
      const a0 = into - Math.PI / 2;
      const a1 = into + Math.PI / 2;
      // the pulse stays inside the arena: parts of it past the border are cut
      const arc = (r: number, width: number, col: number, al: number) => strokeArcInField(g, fx, fy, r, a0, a1, width, col, al);
      if (p.id === this.ctx.myId() && p.d >= 1 && s.boostRadius > 0) {
        // boost ready: faint arc showing how far the pulse reaches
        arc(s.boostRadius, 2, color, 0.25);
      }
      const pulse = this.ctx.lerp(pa.pulse, pb.pulse, alpha);
      if (pulse > 0.02) {
        // boost pulse: shock arcs racing out to the full radius, a soft half disc and radial ticks
        const prog = 1 - pulse;
        const R = s.boostRadius;
        fillSectorInField(g, fx, fy, R * Math.min(1, prog * 1.4 + 0.1), a0, a1, color, 0.22 * pulse);
        for (let k = 0; k < 2; k++) {
          const q = Math.max(0, prog - k * 0.18);
          if (q > 0) arc(R * q, Math.max(2, 10 * (1 - q)), k === 0 ? 0xffffff : color, 0.9 * pulse);
        }
        g.lineStyle(3, 0xffd23f, 0.8 * pulse);
        for (let k = 0; k <= 6; k++) {
          const ang = a0 + (k / 6) * Math.PI;
          const r0 = R * prog * 0.7;
          const r1 = R * Math.min(1, prog * 1.15);
          const x1 = fx + Math.cos(ang) * r1;
          const y1 = fy + Math.sin(ang) * r1;
          if (x1 < C - H || x1 > C + H || y1 < C - H || y1 > C + H) continue;
          g.lineBetween(fx + Math.cos(ang) * r0, fy + Math.sin(ang) * r0, x1, y1);
        }
      }
      for (const v of BALLISTIX_VIEWS) v.paddleUnder?.(f, p, pos);
      g.fillStyle(color, 1).fillPoints(pts, true);
      for (const v of BALLISTIX_VIEWS) v.paddleOver?.(f, p, pos);
      const mine = p.id === this.ctx.myId();
      g.lineStyle(mine ? 6 : 3, mine ? 0xffffff : 0x1b1033, 1).strokePoints(pts, true);
      if (mine && p.d < 1) {
        const [bx, by] = S(p.side, pos - hl + p.len * p.d, H - T - 8);
        const [ax, ay] = S(p.side, pos - hl, H - T - 8);
        g.lineStyle(5, 0x9d82ff, 0.9).lineBetween(ax, ay, bx, by);
      } else if (mine) {
        const [bx, by] = S(p.side, pos + hl, H - T - 8);
        const [ax, ay] = S(p.side, pos - hl, H - T - 8);
        g.lineStyle(5, 0xffd23f, 0.9).lineBetween(ax, ay, bx, by);
      }
      const [lx, ly] = S(p.side, pos, H - T - 26);
      label.setPosition(lx, ly).setVisible(true).setAlpha(1);
    }
  }

  private drawBalls(f: Frame): void {
    const { g, s, a, b, alpha, now, turn } = f;
    const aBall = new Map(a.balls.map((p) => [p.id, p]));
    const bBall = new Map(b.balls.map((p) => [p.id, p]));
    for (const ball of s.balls) {
      const ba = aBall.get(ball.id) ?? ball;
      const bb = bBall.get(ball.id) ?? ball;
      const jump = Math.hypot(bb.x - ba.x, bb.y - ba.y) > 180; // respawn: don't slide across
      const wx = jump ? bb.x : this.ctx.lerp(ba.x, bb.x, alpha);
      const wy = jump ? bb.y : this.ctx.lerp(ba.y, bb.y, alpha);
      const [x, y] = f.W(wx, wy);

      let color = 0xfff7e6;
      let alphaFill = ball.wait ? 0.85 : 1;
      let outlineColor = 0x1b1033;
      let outlineWidth = 4;
      for (const v of BALLISTIX_VIEWS) {
        const st = v.ballStyle?.(f, ball);
        if (!st) continue;
        color = st.color ?? color;
        alphaFill = st.alpha ?? alphaFill;
        outlineColor = st.outlineColor ?? outlineColor;
        outlineWidth = st.outlineWidth ?? outlineWidth;
      }
      if (ball.boost > 0.05) {
        // smashed ball: a fading trail behind its direction of travel
        const tx = bb.x - ba.x;
        const ty = bb.y - ba.y;
        const tl = Math.hypot(tx, ty);
        if (tl > 1 && !jump) {
          const [dx, dy] = rotQuarter(tx / tl, ty / tl, turn);
          for (let i = 1; i <= 4; i++) {
            g.fillStyle(0xff7a2f, 0.4 * ball.boost * (1 - i / 5)).fillCircle(x - dx * i * ball.r * 0.8, y - dy * i * ball.r * 0.8, ball.r * (1 - i * 0.12));
          }
        }
      }
      const br = ball.wait ? ball.r * (0.45 + 0.1 * Math.sin(now / 90)) : ball.r;
      if (!ball.wait) g.fillStyle(0x000000, 0.3).fillCircle(x + 4, y + 8, br);
      g.fillStyle(color, alphaFill).fillCircle(x, y, br);
      g.lineStyle(outlineWidth, outlineColor, 1).strokeCircle(x, y, br);
      g.fillStyle(0xffffff, 0.6).fillCircle(x - br * 0.3, y - br * 0.3, br * 0.25);
    }
  }
}
