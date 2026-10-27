/** Minimal QR Code generator: byte mode, error correction L, versions 1-10 (up to 271 bytes). */

const ECC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const NUM_BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
const MAX_VERSION = 10;

const rawModules = (v: number): number => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
};
const dataCodewords = (v: number): number => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v - 1] * NUM_BLOCKS[v - 1];

// GF(256), x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data: number[], degree: number): number[] {
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const f = b ^ (rem.shift() as number);
    rem.push(0);
    if (f) for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i + 1], f);
  }
  return rem;
}

function bch(value: number, poly: number, polyBits: number, dataBits: number): number {
  let r = value << polyBits;
  for (let i = dataBits + polyBits - 1; i >= polyBits; i--) if ((r >>> i) & 1) r ^= poly << (i - polyBits);
  return (value << polyBits) | r;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The module matrix (true = dark) for `text`, or null when it does not fit in version 10. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  const bitsFor = (v: number) => 4 + (v >= 10 ? 16 : 8) + 8 * bytes.length;
  while (ver <= MAX_VERSION && bitsFor(ver) > dataCodewords(ver) * 8) ver++;
  if (ver > MAX_VERSION) return null;

  // data bits
  const bits: number[] = [];
  const put = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, ver >= 10 ? 16 : 8);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) data.push(pad);

  // blocks + error correction, interleaved
  const nb = NUM_BLOCKS[ver - 1];
  const eccLen = ECC_PER_BLOCK[ver - 1];
  const total = Math.floor(rawModules(ver) / 8);
  const shortLen = Math.floor(total / nb) - eccLen;
  const numShort = nb - (total % nb);
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    blocks.push(d);
    eccs.push(rsRemainder(d, eccLen));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < eccLen; i++) for (const e of eccs) out.push(e[i]);

  // function patterns
  const size = ver * 4 + 17;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    mod[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormatInto(set, 0, size);
  if (ver >= 7) {
    const v = bch(ver, 0x1f25, 12, 6);
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // codewords, zigzag
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < out.length * 8) {
          mod[y][x] = ((out[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0;
          bi++;
        }
      }
    }
  }

  // best mask by a simple penalty (runs, 2x2 blocks, dark balance)
  const apply = (m: number): boolean[][] =>
    mod.map((row, y) => row.map((v, x) => (fn[y][x] ? v : v !== MASKS[m](x, y))));
  const penalty = (g: boolean[][]): number => {
    let p = 0;
    for (let a = 0; a < size; a++) {
      for (const horiz of [true, false]) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          const cur = horiz ? g[a][b] : g[b][a];
          const prev = horiz ? g[a][b - 1] : g[b - 1][a];
          if (cur === prev) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else run = 1;
        }
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (g[y][x]) dark++;
        if (x < size - 1 && y < size - 1 && g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) p += 3;
      }
    }
    return p + Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const s = penalty(apply(m));
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
  }
  const grid = apply(best);
  // re-stamp the format bits for the chosen mask on the masked grid
  drawFormatInto((x, y, d) => (grid[y][x] = d), best, size);
  return grid;
}

/** Writes the 15 format bits (level L + mask) and the always-dark module through `s`. */
function drawFormatInto(s: (x: number, y: number, dark: boolean) => void, mask: number, size: number): void {
  const f = bch((1 << 3) | mask, 0x537, 10, 5) ^ 0x5412;
  const bit = (i: number) => ((f >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) s(8, i, bit(i));
  s(8, 7, bit(6));
  s(8, 8, bit(7));
  s(7, 8, bit(8));
  for (let i = 9; i < 15; i++) s(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) s(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) s(8, size - 15 + i, bit(i));
  s(8, size - 8, true);
}
