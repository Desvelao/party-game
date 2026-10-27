/**
 * Frost Shove: ice radius at `angle`, linearly interpolated between the sector
 * radii (sector i is centred on angle i * 2PI / n). Shared so the server's edge
 * test and the client's drawing agree.
 */
export function polarEdge(sectors: readonly number[], angle: number): number {
  const n = sectors.length;
  const tau = Math.PI * 2;
  const f = ((((angle % tau) + tau) % tau) / tau) * n;
  const i = Math.floor(f) % n;
  const k = f - Math.floor(f);
  return sectors[i] * (1 - k) + sectors[(i + 1) % n] * k;
}
