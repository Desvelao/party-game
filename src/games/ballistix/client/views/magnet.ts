import { H, T } from '../frame';
import type { BallistixView } from '../view';

/** Sand Orb: pull field in front of a pulling paddle, hold-time bar, held-ball outline. */
export const magnetView: BallistixView = {
  id: 'magnet',

  paddleUnder(f, p, pos) {
    const m = f.s.magnet?.paddles.find((q) => q.id === p.id);
    if (!m?.pulling) return;
    const [fx, fy] = f.S(p.side, pos, H - T - 46);
    f.g.fillStyle(0x9fdcff, 0.12 + 0.05 * Math.sin(f.now / 90)).fillCircle(fx, fy, f.s.magnet!.range);
    f.g.lineStyle(3, 0x9fdcff, 0.45).strokeCircle(fx, fy, f.s.magnet!.range);
  },

  paddleOver(f, p, pos) {
    const m = f.s.magnet?.paddles.find((q) => q.id === p.id);
    if (!m || m.holdLeft < 0) return;
    // remaining hold time: a bar behind the paddle that drains left -> right
    const barW = Math.max(p.len, 120);
    const hot = m.holdLeft < 0.34;
    const [ax, ay] = f.S(p.side, pos - barW / 2, H + 16);
    const [bx, by] = f.S(p.side, pos + barW / 2, H + 16);
    f.g.lineStyle(14, 0x000000, 0.45).lineBetween(ax, ay, bx, by);
    const [cx, cy] = f.S(p.side, pos - barW / 2 + barW * m.holdLeft, H + 16);
    f.g.lineStyle(10, hot ? 0xff4f4f : 0xffd23f, 1).lineBetween(ax, ay, cx, cy);
  },

  ballStyle(f, ball) {
    return f.s.magnet?.held.includes(ball.id) ? { outlineColor: 0x9fdcff, outlineWidth: 7 } : undefined;
  },

  handleEvent(e, fx, ctx) {
    if (e.kind === 'catch') {
      ctx.sfx('bump');
      fx.burst(e.x, e.y, 0x9fdcff, 8, 180);
      return true;
    }
    if (e.kind === 'release') {
      ctx.sfx('click');
      fx.burst(e.x, e.y, 0xffffff, 5, 140);
      return true;
    }
    return false;
  },
};
