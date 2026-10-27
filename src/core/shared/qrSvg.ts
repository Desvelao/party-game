import { qrMatrix } from './qr';

/** The QR code of `text` as standalone SVG markup (4-module quiet zone on white), or null when it does not fit. */
export function qrSvgMarkup(text: string): string | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const n = m.length + 8;
  let d = '';
  m.forEach((row, y) => row.forEach((v, x) => (d += v ? `M${x + 4} ${y + 4}h1v1h-1z` : '')));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * 8}" height="${n * 8}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
