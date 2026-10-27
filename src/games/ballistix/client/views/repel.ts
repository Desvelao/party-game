import { fillSectorInField, strokeArcInField } from '../clip';
import { H, T } from '../frame';
import type { BallistixView } from '../view';

const RED = 0xff3b3b;

/** Pulse Ball: the repulsion power-up in its corner and the red force field around the paddle that took it. */
export const repelView: BallistixView = {
  id: 'repel',

  world(f) {
    const it = f.s.repel?.item;
    if (!it) return;
    const g = f.g;
    const [x, y] = f.W(it.x, it.y);
    const pulse = 0.5 + 0.5 * Math.sin(f.now / 160);
    g.fillStyle(RED, 0.18 + 0.12 * pulse).fillCircle(x, y, 30 + 6 * pulse);
    g.fillStyle(0x7a1010, 1).fillCircle(x, y, 17);
    g.fillStyle(RED, 1).fillCircle(x, y, 13);
    g.lineStyle(3, 0xffffff, 0.95).strokeCircle(x, y, 17);
    // four outward chevrons: "pushes away"
    g.lineStyle(3, 0xffffff, 0.95);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      g.lineBetween(x + Math.cos(a) * 5, y + Math.sin(a) * 5, x + Math.cos(a) * 11, y + Math.sin(a) * 11);
    }
    // time before it vanishes
    g.lineStyle(4, RED, 0.9).beginPath().arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * it.life, false).strokePath();
  },

  paddleUnder(f, p, pos) {
    const rep = f.s.repel;
    const e = rep?.paddles.find((q) => q.id === p.id);
    if (!rep || !e) return;
    const g = f.g;
    const R = rep.radius;
    const [fx, fy] = f.S(p.side, pos, H - T / 2);
    const [ix, iy] = f.S(p.side, pos, H - T / 2 - 1);
    const into = Math.atan2(iy - fy, ix - fx);
    const a0 = into - Math.PI / 2;
    const a1 = into + Math.PI / 2;
    const fade = Math.min(1, e.left / 0.25);
    // clipped to the arena: the area only applies inside the field
    fillSectorInField(g, fx, fy, R, a0, a1, RED, (0.1 + 0.05 * Math.sin(f.now / 110)) * fade);
    // rings flowing outward, away from the paddle
    for (let k = 0; k < 3; k++) {
      const q = (f.now / 900 + k / 3) % 1;
      strokeArcInField(g, fx, fy, R * q, a0, a1, Math.max(2, 7 * (1 - q)), RED, 0.85 * (1 - q) * fade);
    }
    strokeArcInField(g, fx, fy, R, a0, a1, 3, RED, 0.6 * fade);
  },

  paddleOver(f, p, pos) {
    const e = f.s.repel?.paddles.find((q) => q.id === p.id);
    if (!e) return;
    // remaining time: a red bar behind the paddle
    const w = Math.max(p.len, 100);
    const [ax, ay] = f.S(p.side, pos - w / 2, H + 12);
    const [bx, by] = f.S(p.side, pos - w / 2 + w * e.left, H + 12);
    const [cx, cy] = f.S(p.side, pos + w / 2, H + 12);
    f.g.lineStyle(10, 0x000000, 0.45).lineBetween(ax, ay, cx, cy);
    f.g.lineStyle(7, RED, 1).lineBetween(ax, ay, bx, by);
  },

  handleEvent(e, fx, ctx) {
    if (e.kind === 'pickup') {
      ctx.sfx('bump');
      fx.burst(e.x, e.y, RED, 10, 200);
      return true;
    }
    return false;
  },
};
