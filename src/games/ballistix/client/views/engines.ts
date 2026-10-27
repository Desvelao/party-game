import { C } from '../frame';
import type { BallistixView } from '../view';

/** Cloud Orbs: corner engines drawn as turbines that sputter, fail and drag balls. */
export const enginesView: BallistixView = {
  id: 'engines',

  corner(f, i, x, y, half, deckX, deckY) {
    const en = f.s.engines?.[i];
    if (!en) return false;
    const g = f.g;
    const t = f.now;
    const dxs = Math.sign(C - x);
    const dys = Math.sign(C - y);
    const bad = en.phase !== 'ok';
    // the engine holds still while the deck above it may drop: a strut joins the two
    if (Math.hypot(deckX - x, deckY - y) > 1) {
      g.lineStyle(8, bad ? 0xff8a3d : 0x9d82ff, 0.9).lineBetween(x, y, deckX, deckY);
    }
    const flicker = bad ? 0.5 + 0.5 * Math.sin(t / (en.phase === 'warn' ? 60 : 110)) : 1;
    const spin = bad ? t / (en.phase === 'warn' ? 90 : 420) : t / 70;
    g.fillStyle(bad ? 0x5a1a2e : 0x2a2150, 1).fillCircle(x, y, half - 6);
    g.lineStyle(4, bad ? 0xff4f4f : 0x35e0c2, 0.6 + 0.4 * flicker).strokeCircle(x, y, half - 6);
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * Math.PI * 2) / 3;
      g.lineStyle(8, bad ? 0xff8a3d : 0xcfd8ff, 0.9).lineBetween(x, y, x + Math.cos(a) * (half - 10), y + Math.sin(a) * (half - 10));
    }
    g.fillStyle(0xfff7e6, 1).fillCircle(x, y, 6);
    if (bad) {
      // time left until it recovers + sparks
      g.lineStyle(6, en.phase === 'warn' ? 0xffd23f : 0xff4f4f, 0.95);
      g.beginPath();
      g.arc(x, y, half + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * en.left, false);
      g.strokePath();
      if (en.phase === 'fail' && flicker > 0.6) g.fillStyle(0xffd23f, 0.9).fillCircle(x + dxs * 14 * flicker, y + dys * 22, 4);
    }
    if (en.pull > 0.05) {
      // dots streaming from the field towards the failing engine
      for (let k = 0; k < 4; k++) {
        const p = (t / 600 + k / 4) % 1;
        const px = C + (x - C) * (0.25 + 0.6 * p);
        const py = C + (y - C) * (0.25 + 0.6 * p);
        g.fillStyle(0xff8fb8, 0.55 * en.pull * (1 - p * 0.6)).fillCircle(px, py, 9);
      }
    }
    return true;
  },

  handleEvent(e, fx, ctx) {
    if (e.kind !== 'engine') return false;
    const fail = e.id.endsWith(':fail');
    ctx.sfx(fail ? 'hazard' : 'go');
    fx.burst(e.x, e.y, fail ? 0xff4f4f : 0x35e0c2, 14, 260);
    if (fail) fx.shake(160, 0.006);
    return true;
  },
};
