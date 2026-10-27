/**
 * Tank Wars arena (world units, WORLD_SIZE = 1000). Shared so the server
 * simulation and the client renderer agree on walls and spawns.
 */
export interface TankRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** playable field (tanks stay inside) */
export const TANK_MIN = 60;
export const TANK_MAX = 940;
export const TANK_R = 22;

/** the maze of Desert Fox / Metal Fox: a 3x3 grid of square blocks with 160-wide corridors */
export const TANK_BLOCKS: TankRect[] = [220, 500, 780].flatMap((cy) =>
  [220, 500, 780].map((cx) => ({ x: cx - 60, y: cy - 60, w: 120, h: 120 })),
);

/** Metal Fox: thin metal walls that rise and fall; `group` 0 and 1 are raised alternately */
export const TANK_METAL_WALLS: (TankRect & { group: number })[] = [
  { x: 280, y: 490, w: 160, h: 20, group: 0 },
  { x: 560, y: 490, w: 160, h: 20, group: 0 },
  { x: 490, y: 280, w: 20, h: 160, group: 1 },
  { x: 490, y: 560, w: 20, h: 160, group: 1 },
];

/** With rails on the inner corridors are narrowed to 60 so the road hugs the blocks (same 3x3 grid). */
const RAIL_SPANS: [number, number][] = [
  [160, 330],
  [390, 610],
  [670, 840],
];
export const TANK_RAIL_BLOCKS: TankRect[] = RAIL_SPANS.flatMap(([y0, y1]) =>
  RAIL_SPANS.map(([x0, x1]) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })),
);

/** Metal walls for the narrowed rails layout; same order and groups as TANK_METAL_WALLS. */
export const TANK_RAIL_METAL_WALLS: (TankRect & { group: number })[] = [
  { x: 330, y: 490, w: 60, h: 20, group: 0 },
  { x: 610, y: 490, w: 60, h: 20, group: 0 },
  { x: 490, y: 330, w: 20, h: 60, group: 1 },
  { x: 490, y: 610, w: 20, h: 60, group: 1 },
];

/** where players start (corners and edges of the field), by seat */
export const TANK_SPAWNS: { x: number; y: number; f: number }[] = [
  { x: 110, y: 110, f: 0 },
  { x: 890, y: 890, f: Math.PI },
  { x: 890, y: 110, f: Math.PI / 2 },
  { x: 110, y: 890, f: -Math.PI / 2 },
  { x: 500, y: 110, f: Math.PI / 2 },
  { x: 500, y: 890, f: -Math.PI / 2 },
  { x: 110, y: 500, f: 0 },
  { x: 890, y: 500, f: Math.PI },
];

/**
 * "Rails": the centre lines of the maze corridors. With rails on a tank only drives along these
 * lines and turns at their crossings, like the original Desert Fox / Metal Fox.
 */
export const TANK_RAILS = [110, 360, 640, 890];
/** how close to a crossing a turn is accepted (the tank is then snapped onto the new rail) */
export const TANK_RAIL_TURN = 14;
/** the extent of the rail network: the outer square formed by the outermost rails */
export const RAIL_MIN = TANK_RAILS[0];
export const RAIL_MAX = TANK_RAILS[TANK_RAILS.length - 1];

/** The rail coordinate closest to `v`. */
export function nearestRail(v: number): number {
  let best = TANK_RAILS[0];
  for (const r of TANK_RAILS) if (Math.abs(r - v) < Math.abs(best - v)) best = r;
  return best;
}

export const TANK_CENTRE = 500;

/** the floor is drawn as a checkerboard of squares this wide; the full field is TANK_FULL_SIZE of them */
export const TANK_SQUARE = 80;
export const TANK_FULL_SIZE = (TANK_MAX - TANK_MIN) / TANK_SQUARE;

/** Edges of the playable field when it is `size` squares wide, centred (the full field is TANK_MIN..TANK_MAX). */
export function arenaBounds(size: number): { min: number; max: number } {
  const half = (Math.min(TANK_FULL_SIZE, size) * TANK_SQUARE) / 2;
  return { min: TANK_CENTRE - half, max: TANK_CENTRE + half };
}

/** A smaller field is closed in by four solid bars outside it (none at the full size). */
export function arenaBorder(size: number): TankRect[] {
  if (size >= TANK_FULL_SIZE) return [];
  const { min, max } = arenaBounds(size);
  const W = TANK_CENTRE * 2;
  return [
    { x: 0, y: 0, w: W, h: min },
    { x: 0, y: max, w: W, h: W - max },
    { x: 0, y: min, w: min, h: max - min },
    { x: max, y: min, w: W - max, h: max - min },
  ];
}
/** Jungle Fox: the totem's impact zone from the centre outwards */
export const TANK_TOTEM_LEN = 300;
export const TANK_TOTEM_HALF = 35;
/** Jungle Fox: the solid post in the middle that the totem falls from (a square, centred) */
export const TANK_TOTEM_POST: TankRect = { x: TANK_CENTRE - 100, y: TANK_CENTRE - 100, w: 200, h: 200 };
