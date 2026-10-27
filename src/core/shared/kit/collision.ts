// Simple analytic collision helpers - no physics engine on the server.

export function circleCircle(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const r = ar + br;
  return dx * dx + dy * dy < r * r;
}

/** Circle vs axis-aligned rectangle (x,y = top-left). */
export function circleAABB(
  cx: number,
  cy: number,
  cr: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

export interface Contact {
  hit: boolean;
  /** unit normal pointing from the rectangle towards the circle (world space) */
  nx: number;
  ny: number;
  depth: number;
}

const NO_CONTACT: Contact = { hit: false, nx: 0, ny: 0, depth: 0 };

/**
 * Circle vs a rotated bar. The bar starts at (ox,oy), extends `length` along
 * `angle`, and is `2*halfWidth` thick.
 */
export function circleBar(
  cx: number,
  cy: number,
  cr: number,
  ox: number,
  oy: number,
  angle: number,
  length: number,
  halfWidth: number,
): Contact {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = cx - ox;
  const dy = cy - oy;
  // circle centre in the bar's local frame
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const qx = Math.max(0, Math.min(lx, length));
  const qy = Math.max(-halfWidth, Math.min(ly, halfWidth));
  let ex = lx - qx;
  let ey = ly - qy;
  const d2 = ex * ex + ey * ey;
  if (d2 >= cr * cr) return NO_CONTACT;
  let depth: number;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    ex /= d;
    ey /= d;
    depth = cr - d;
  } else {
    // centre inside the bar: push out sideways
    ex = 0;
    ey = ly >= 0 ? 1 : -1;
    depth = cr + halfWidth - Math.abs(ly);
  }
  // rotate the local normal back to world space
  return { hit: true, nx: ex * cos - ey * sin, ny: ex * sin + ey * cos, depth };
}
