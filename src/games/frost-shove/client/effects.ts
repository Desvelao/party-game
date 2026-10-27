// Short-lived effects of Frost Shove (Lightning going off, Weight dropping, a pass). The scene's `host.g` is cleared every
// frame, so an event pushes an effect here with its start time and the renderer redraws the live ones until they expire.
import type Phaser from 'phaser';
import type { PolarPlayerState } from '../shared/types';

export const LIGHTNING_COLOR = 0xfff08a;
export const WEIGHT_COLOR = 0xff5a5a;
const MAX_FX = 14;

type Fx =
  | { k: 'ring'; x: number; y: number; t0: number; dur: number; r: number; color: number }
  | { k: 'flash'; x: number; y: number; t0: number; dur: number; r: number }
  | { k: 'bolt'; x: number; y: number; x2: number; y2: number; t0: number; dur: number; seed: number }
  | { k: 'streak'; x: number; y: number; x2: number; y2: number; t0: number; dur: number; color: number }
  | { k: 'weight'; x: number; y: number; t0: number; dur: number }
  /** ice chips (or water droplets) thrown from (x, y) in direction (dx, dy) */
  | { k: 'chips'; x: number; y: number; dx: number; dy: number; t0: number; dur: number }
  | { k: 'splash'; x: number; y: number; dx: number; dy: number; t0: number; dur: number };

let live: Fx[] = [];
/** the bears of the latest snapshot: an event only says where it happened, not who else is on the ice */
let bears: PolarPlayerState[] = [];

export const WEIGHT_FALL_MS = 300;

export function resetFx(): void {
  live = [];
  bears = [];
}

export function seeBears(players: PolarPlayerState[]): void {
  bears = players;
}

export const bearsNow = (): readonly PolarPlayerState[] => bears;

type NewFx = Fx extends infer T ? (T extends unknown ? Omit<T, 't0'> : never) : never;

export function pushFx(fx: NewFx): void {
  if (live.length >= MAX_FX) live.shift();
  live.push({ ...fx, t0: performance.now() } as Fx);
}

/** a jagged line from (x, y) to (x2, y2): the same shape for the whole life of one bolt */
function zigzag(g: Phaser.GameObjects.Graphics, x: number, y: number, x2: number, y2: number, seed: number, w: number, color: number, alpha: number): void {
  const n = 7;
  const len = Math.hypot(x2 - x, y2 - y) || 1;
  const nx = -(y2 - y) / len;
  const ny = (x2 - x) / len;
  const pts = [{ x, y }];
  for (let i = 1; i < n; i++) {
    const j = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const off = ((j - Math.floor(j)) - 0.5) * 46;
    pts.push({ x: x + ((x2 - x) * i) / n + nx * off, y: y + ((y2 - y) * i) / n + ny * off });
  }
  pts.push({ x: x2, y: y2 });
  g.lineStyle(w, color, alpha).strokePoints(pts, false);
}

/** the heavy block of the Weight power-up, `u` = half the size of its tile */
function weightBlock(g: Phaser.GameObjects.Graphics, x: number, y: number, u: number, alpha: number): void {
  const s = u / 24;
  g.fillStyle(0x8a8a8a, alpha).fillRoundedRect(x - 30 * s, y - 8 * s, 60 * s, 36 * s, 6 * s);
  g.fillPoints([{ x: x - 18 * s, y: y - 8 * s }, { x: x - 10 * s, y: y - 28 * s }, { x: x + 10 * s, y: y - 28 * s }, { x: x + 18 * s, y: y - 8 * s }], true);
  g.fillStyle(0x1b1033, alpha).fillRect(x - 16 * s, y + 6 * s, 32 * s, 6 * s);
  g.lineStyle(4, 0x1b1033, alpha).strokeRoundedRect(x - 30 * s, y - 8 * s, 60 * s, 36 * s, 6 * s);
}

/** draw the live effects; `m` is the motion setting (0 = nothing moves: a still picture that fades) */
export function drawFx(g: Phaser.GameObjects.Graphics, now: number, m: number): void {
  live = live.filter((f) => now - f.t0 < f.dur);
  for (const f of live) {
    const k = (now - f.t0) / f.dur;
    switch (f.k) {
      case 'ring': {
        const r = m > 0 ? f.r * (0.15 + 0.85 * k) : f.r * 0.5;
        g.lineStyle(10 * (1 - k) + 2, f.color, 1 - k).strokeCircle(f.x, f.y, r);
        break;
      }
      case 'flash':
        g.fillStyle(0xffffff, (1 - k) * 0.9).fillCircle(f.x, f.y, f.r * (m > 0 ? 1 + k * 0.5 : 1));
        break;
      case 'bolt':
        zigzag(g, f.x, f.y, f.x2, f.y2, f.seed, 10, LIGHTNING_COLOR, (1 - k) * 0.5);
        zigzag(g, f.x, f.y, f.x2, f.y2, f.seed, 4, 0xffffff, 1 - k);
        break;
      case 'streak': {
        // the item flying from the old holder to the new one
        const head = m > 0 ? k : 1;
        const tail = Math.max(0, head - 0.4);
        g.lineStyle(8 * (1 - k) + 2, f.color, 1 - k).lineBetween(
          f.x + (f.x2 - f.x) * tail, f.y + (f.y2 - f.y) * tail,
          f.x + (f.x2 - f.x) * head, f.y + (f.y2 - f.y) * head,
        );
        break;
      }
      case 'chips':
      case 'splash': {
        if (m === 0) break;
        const base = Math.atan2(f.dy, f.dx);
        for (let i = 0; i < 6; i++) {
          const a = base + (i - 2.5) * 0.35;
          const d = (34 + (i % 3) * 10) * k;
          const px = f.x + Math.cos(a) * d;
          const py = f.y + Math.sin(a) * d - (f.k === 'splash' ? Math.sin(Math.PI * k) * 18 : 0);
          if (f.k === 'chips') g.fillStyle(i % 2 ? 0xffffff : 0xbfe8ff, 1 - k).fillRect(px - 3, py - 3, 6, 6);
          else g.fillStyle(0xbfe8ff, 1 - k).fillCircle(px, py, 3.5);
        }
        break;
      }
      case 'weight': {
        const fall = (WEIGHT_FALL_MS / f.dur);
        if (k < fall) {
          // falling: it speeds up, and its shadow grows on the ice
          const q = k / fall;
          const y = m > 0 ? f.y - 320 * (1 - q * q) : f.y - 30;
          g.fillStyle(0x000000, 0.15 + 0.3 * q).fillEllipse(f.x, f.y + 22, 40 + 50 * q, 14 + 14 * q);
          weightBlock(g, f.x, y, 30, 1);
        } else {
          // landed: squashed on the bear, then it fades
          const a = 1 - (k - fall) / (1 - fall);
          g.fillStyle(0x000000, 0.4 * a).fillEllipse(f.x, f.y + 22, 90, 28);
          weightBlock(g, f.x, f.y - 6, 30, a);
          if (m > 0) g.lineStyle(8 * a, 0xffffff, 0.6 * a).strokeCircle(f.x, f.y + 10, 40 + 120 * (1 - a));
        }
        break;
      }
    }
  }
}
