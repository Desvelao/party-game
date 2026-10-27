import { describe, expect, it } from 'vitest';
import { enclosedTiles } from './loops';

const grid = (rows: string[]) => rows.join('').split('').map((ch) => (ch === 'X' ? 0 : -1));

describe('enclosedTiles', () => {
  it('finds a hole inside a ring', () => {
    const t = grid(['......', '.XXX..', '.X.X..', '.XXX..', '......', '......']);
    expect(enclosedTiles(t, 6, 0)).toEqual([2 * 6 + 2]);
  });

  it('the arena edge does not close a region', () => {
    const corner = grid(['..X...', '.XX...', 'XX....', '......', '......', '......']);
    expect(enclosedTiles(corner, 6, 0)).toEqual([]);
    const line = grid(Array.from({ length: 5 }, () => '..X..'));
    expect(enclosedTiles(line, 5, 0)).toEqual([]);
  });

  it('a wall-to-wall cross encloses nothing', () => {
    const t = grid(['..X..', '..X..', 'XXXXX', '..X..', '..X..']);
    expect(enclosedTiles(t, 5, 0)).toEqual([]);
  });

  it('a diagonal-only wall encloses nothing', () => {
    const diamond = grid(['......', '..X...', '.X.X..', '..X...', '......', '......']);
    expect(enclosedTiles(diamond, 6, 0)).toEqual([]);
    const corner = grid(['..X...', '.X....', 'X.....', '......', '......', '......']);
    expect(enclosedTiles(corner, 6, 0)).toEqual([]);
  });

  it('the same diamond closed orthogonally encloses its centre', () => {
    const t = grid(['......', '.XXX..', '.X.X..', '.XXX..', '......', '......']);
    expect(enclosedTiles(t, 6, 0)).toEqual([2 * 6 + 2]);
  });

  it('encloses nothing for an open shape', () => {
    const t = grid(['......', '.XXX..', '.X.X..', '.X.X..', '......', '......']);
    expect(enclosedTiles(t, 6, 0)).toEqual([]);
  });

  it('returns nothing for an empty board or a board with no other tiles', () => {
    expect(enclosedTiles(grid(['......', '......', '......', '......', '......', '......']), 6, 0)).toEqual([]);
    expect(enclosedTiles(new Array(36).fill(0), 6, 0)).toEqual([]);
  });

  it('a pocket on the edge does not fill', () => {
    const t = grid(['X.X...', 'XXX...', '......', '......', '......', '......']);
    expect(enclosedTiles(t, 6, 0)).toEqual([]);
  });

  it('a big interior ring fills even when the outside is smaller', () => {
    const t = grid(['......', '.XXXX.', '.X..X.', '.X..X.', '.XXXX.', '......']);
    expect(enclosedTiles(t, 6, 0).sort((a, b) => a - b)).toEqual([14, 15, 20, 21]);
  });

  it('every separate interior hole counts as enclosed', () => {
    const t = grid(['.......', '.XXXXX.', '.X.X.X.', '.XXXXX.', '.......', '.......', '.......']);
    expect(enclosedTiles(t, 7, 0).sort((a, b) => a - b)).toEqual([16, 18]);
  });

  it('other owners tiles count as open space and are swallowed by a loop', () => {
    const n = 6;
    const t = new Array<number>(n * n).fill(-1);
    for (const [c, r] of [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]]) t[r * n + c] = 0;
    t[2 * n + 2] = 1; // a rival tile inside the ring
    t[0] = 1; // and one outside
    expect(enclosedTiles(t, n, 0)).toEqual([2 * n + 2]);
    // from the rival's viewpoint nothing is enclosed
    expect(enclosedTiles(t, n, 1)).toEqual([]);
  });
});
