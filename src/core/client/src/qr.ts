import { qrMatrix } from '../../shared/qr';

/** An <svg> with a 4-module quiet zone on white (readable on dark themes). */
export function qrSvg(text: string, px = 220): SVGSVGElement | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const n = m.length + 8;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(n));
  bg.setAttribute('height', String(n));
  bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(ns, 'path');
  let d = '';
  m.forEach((row, y) => row.forEach((v, x) => (d += v ? `M${x + 4} ${y + 4}h1v1h-1z` : '')));
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}
