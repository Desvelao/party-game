/** Spring Showdown board: a square of tiles inside the world, leaving room for the HUD. */
export const POGO_BOARD = { x: 80, y: 70, size: 840 };

/** World-space centre of tile (c,r) on an n x n Pogo board. */
export function pogoTileCenter(c: number, r: number, n: number): [number, number] {
  const cell = POGO_BOARD.size / n;
  return [POGO_BOARD.x + (c + 0.5) * cell, POGO_BOARD.y + (r + 0.5) * cell];
}
