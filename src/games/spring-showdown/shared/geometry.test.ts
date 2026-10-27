import { describe, expect, it } from 'vitest';
import { POGO_BOARD, pogoTileCenter } from './geometry';

function expectPoint(actual: [number, number], expected: [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe('pogoTileCenter', () => {
  it('returns the centre of the first and last tile', () => {
    const n = 7;
    const cell = POGO_BOARD.size / n;
    expectPoint(pogoTileCenter(0, 0, n), [POGO_BOARD.x + cell / 2, POGO_BOARD.y + cell / 2]);
    expectPoint(pogoTileCenter(n - 1, n - 1, n), [
      POGO_BOARD.x + POGO_BOARD.size - cell / 2,
      POGO_BOARD.y + POGO_BOARD.size - cell / 2,
    ]);
  });

  it('uses c for x and r for y', () => {
    const [x0, y0] = pogoTileCenter(0, 0, 6);
    const [x1, y1] = pogoTileCenter(2, 0, 6);
    const [x2, y2] = pogoTileCenter(0, 3, 6);
    expect(y1).toBeCloseTo(y0, 9);
    expect(x1 - x0).toBeCloseTo((2 * POGO_BOARD.size) / 6, 9);
    expect(x2).toBeCloseTo(x0, 9);
    expect(y2 - y0).toBeCloseTo((3 * POGO_BOARD.size) / 6, 9);
  });

  it('is symmetric about the board centre for mirrored tiles', () => {
    const n = 8;
    const mx = POGO_BOARD.x + POGO_BOARD.size / 2;
    const my = POGO_BOARD.y + POGO_BOARD.size / 2;
    for (let c = 0; c < n; c++) {
      for (let r = 0; r < n; r++) {
        const [x, y] = pogoTileCenter(c, r, n);
        const [x2, y2] = pogoTileCenter(n - 1 - c, n - 1 - r, n);
        expect(x + x2).toBeCloseTo(2 * mx, 9);
        expect(y + y2).toBeCloseTo(2 * my, 9);
      }
    }
  });

  it('puts the single tile of a 1x1 board at the board centre', () => {
    expectPoint(pogoTileCenter(0, 0, 1), [
      POGO_BOARD.x + POGO_BOARD.size / 2,
      POGO_BOARD.y + POGO_BOARD.size / 2,
    ]);
  });
});
