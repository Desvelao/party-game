import type { RenderHost } from '../../../core/client/src/scenes/host';
import { C, H } from './frame';

type G = RenderHost['g'];
type Pt = { x: number; y: number };

const inside = (p: Pt) => p.x >= C - H && p.x <= C + H && p.y >= C - H && p.y <= C + H;
const clampPt = (p: Pt): Pt => ({ x: Math.min(C + H, Math.max(C - H, p.x)), y: Math.min(C + H, Math.max(C - H, p.y)) });

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  const n = 28;
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

/** Stroke an arc, skipping the parts that lie outside the (square, centred) field. */
export function strokeArcInField(g: G, cx: number, cy: number, r: number, a0: number, a1: number, width: number, color: number, alpha: number): void {
  g.lineStyle(width, color, alpha);
  let run: Pt[] = [];
  const flush = () => {
    if (run.length > 1) {
      g.beginPath().moveTo(run[0].x, run[0].y);
      for (const p of run.slice(1)) g.lineTo(p.x, p.y);
      g.strokePath();
    }
    run = [];
  };
  for (const p of arcPoints(cx, cy, r, a0, a1)) {
    if (inside(p)) run.push(p);
    else flush();
  }
  flush();
}

/** Fill a circular sector, kept inside the field. */
export function fillSectorInField(g: G, cx: number, cy: number, r: number, a0: number, a1: number, color: number, alpha: number): void {
  const pts = [{ x: cx, y: cy }, ...arcPoints(cx, cy, r, a0, a1).map(clampPt)];
  g.fillStyle(color, alpha).fillPoints(pts, true);
}
