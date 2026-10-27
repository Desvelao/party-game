/**
 * Squares enclosed by `owner`: connected (8-neighbour) regions of tiles not owned by `owner` that
 * do not touch the arena edge. Regions leak through diagonal gaps, so the owner's wall must be
 * orthogonally connected; the arena edge never closes a region, so a line (or cross) of your
 * colour running wall to wall encloses nothing.
 */
export function enclosedTiles(tiles: ArrayLike<number>, n: number, owner: number): number[] {
  const region = new Int32Array(n * n).fill(-1);
  const stack: number[] = [];
  const out: number[] = [];
  for (let start = 0; start < n * n; start++) {
    if (tiles[start] === owner || region[start] >= 0) continue;
    const from = out.length;
    let edge = false;
    region[start] = start;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      out.push(i);
      const c = i % n;
      const r = (i - c) / n;
      if (c === 0 || r === 0 || c === n - 1 || r === n - 1) edge = true;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= n) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= n) continue;
          const j = rr * n + cc;
          if (tiles[j] === owner || region[j] >= 0) continue;
          region[j] = start;
          stack.push(j);
        }
      }
    }
    if (edge) out.length = from; // touches the edge: outside
  }
  return out;
}
