import { C } from '../frame';
import type { BallistixView } from '../view';

/** Pulse Ball: the ball-bot in the middle and the (fading) balls it fires. */
export const enemyView: BallistixView = {
  id: 'enemy',

  world(f) {
    const en = f.s.enemy;
    if (!en || en.phase === 'off') return;
    const g = f.g;
    const warn = en.phase === 'warn';
    const pulse = 0.5 + 0.5 * Math.sin(f.now / 70);
    g.fillStyle(0x000000, 0.35).fillCircle(C + 6, C + 10, en.r);
    g.fillStyle(warn ? 0x6a55b8 : 0x3b2a73, warn ? 0.55 + 0.3 * pulse : 1).fillCircle(C, C, en.r);
    g.lineStyle(6, warn ? 0xffd23f : 0xff4f8b, 1).strokeCircle(C, C, en.r);
    // barrel (the field is rotated for the viewer)
    const ang = en.angle + (f.turn * Math.PI) / 2;
    g.lineStyle(16, warn ? 0x9d82ff : 0xff4f8b, 1).lineBetween(C, C, C + Math.cos(ang) * (en.r + 14), C + Math.sin(ang) * (en.r + 14));
    g.fillStyle(0xfff7e6, 1).fillCircle(C, C, 12);
    // remaining time: an arc around the body
    g.lineStyle(7, warn ? 0xffd23f : 0xff8fb8, 0.95);
    g.beginPath();
    g.arc(C, C, en.r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * en.left, false);
    g.strokePath();
  },

  ballStyle(f, ball) {
    const mine = f.s.enemy?.balls.find((b) => b.id === ball.id);
    if (!mine) return undefined;
    // fired by the bot: fading out as its life runs down
    return { alpha: 0.45 + 0.55 * Math.min(1, mine.life * 3) };
  },

  handleEvent(e, fx, ctx) {
    if (e.kind !== 'enemy') return false;
    ctx.sfx('hazard');
    fx.burst(e.x, e.y, 0xff4f8b, 22, 380);
    fx.shake(200, 0.008);
    return true;
  },
};
