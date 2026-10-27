import { FIELD_HALF, rotQuarter } from '../../shared/geometry';
import type { BallArenaState } from '../../shared/types';
import { C, type Frame, type Warp } from '../frame';
import type { BallistixView } from '../view';

const H = FIELD_HALF;
/** a corner that has fully dropped moves this far (px): towards the middle and down the screen */
const DROP_IN = 14;
const DROP_DOWN = 14;
/** how far the platform rocks on the air (px) */
const BOB = 3;

const smooth = (t: number) => t * t * (3 - 2 * t);

// scratch state of the one warp alive at a time: the deck is drawn from a single frame, so nothing is allocated per call
const sx = [0, 0, 0, 0];
const sy = [0, 0, 0, 0];
const offX = [0, 0, 0, 0];
const offY = [0, 0, 0, 0];
const drop = [0, 0, 0, 0];
const warp: Warp = {
  lift: 0,
  drop,
  at(x, y) {
    const u = Math.max(-1, Math.min(1, (x - C) / H));
    const v = Math.max(-1, Math.min(1, (y - C) / H));
    let dx = 0;
    let dy = 0;
    for (let k = 0; k < 4; k++) {
      const w = ((1 + sx[k] * u) * (1 + sy[k] * v)) / 4;
      dx += w * offX[k];
      dy += w * offY[k];
    }
    return [dx, dy];
  },
};

/**
 * The platform of Cloud Orbs. It hangs in the air: it rocks gently, and when an engine fails the deck above that
 * engine drops while the engine stays where it is. Only a look: the balls keep their flat-field physics (the engine's
 * pull already drags them towards the failing corner, as a tilted deck would).
 * `drop` follows the server's pull ramp (0 -> 1 in 0.5 s), so it eases in and out by itself.
 */
export function platformWarp(s: BallArenaState, a: BallArenaState, b: BallArenaState, alpha: number, now: number, turn: number, motion: number): Warp | null {
  if (s.variant !== 'cloud-orbs') return null;
  const bob = Math.sin(now / 720) * BOB * motion;
  warp.lift = bob;
  for (let i = 0; i < 4; i++) {
    // where world corner i is on screen, and which screen corner that is
    const [cx, cy] = rotQuarter(i === 1 || i === 2 ? 1 : -1, i >= 2 ? 1 : -1, turn);
    // screen corner order: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left
    const slot = cy < 0 ? (cx < 0 ? 0 : 1) : cx < 0 ? 3 : 2;
    sx[slot] = cx;
    sy[slot] = cy;
    const ea = a.engines?.[i];
    const eb = b.engines?.[i];
    const en = s.engines?.[i];
    const pull = en ? ea && eb ? ea.pull + (eb.pull - ea.pull) * alpha : en.pull : 0;
    const d = smooth(Math.max(0, Math.min(1, pull)));
    drop[slot] = d;
    // each corner sways a little on its own so the deck rolls instead of just bobbing
    let wob = Math.sin(now / 910 + i * 1.7) * 1.5 * motion;
    if (en?.phase === 'warn') wob += Math.sin(now / 28) * 1.6 * motion;
    else if (d > 0) wob += Math.sin(now / 190) * 2 * d * motion;
    offX[slot] = -cx * DROP_IN * d;
    offY[slot] = -bob + wob + (-cy * DROP_IN * d + DROP_DOWN * d);
  }
  return warp;
}

/** soft clouds drifting far below the platform: x0,y0 (world), size, speed (px/s) */
const CLOUDS = [
  { x: 80, y: 120, w: 220, h: 60, v: 9 },
  { x: 640, y: 40, w: 300, h: 80, v: 6 },
  { x: 300, y: 520, w: 260, h: 70, v: 11 },
  { x: 860, y: 700, w: 240, h: 64, v: 7 },
  { x: 120, y: 880, w: 320, h: 84, v: 5 },
  { x: 560, y: 960, w: 200, h: 52, v: 10 },
];
const WRAP = 1500;

export const platformView: BallistixView = {
  id: 'platform',

  warp: platformWarp,

  backdrop(f: Frame) {
    if (!f.warp) return;
    const g = f.g;
    for (const c of CLOUDS) {
      // they drift only when motion is allowed; otherwise they stay where they are
      const x = ((c.x + (f.now / 1000) * c.v * f.motion + 250) % WRAP) - 250;
      g.fillStyle(0xbfd4ff, 0.1).fillEllipse(x, c.y, c.w, c.h);
      g.fillStyle(0xbfd4ff, 0.07).fillEllipse(x + c.w * 0.3, c.y - c.h * 0.25, c.w * 0.6, c.h * 0.8);
    }
  },
};
