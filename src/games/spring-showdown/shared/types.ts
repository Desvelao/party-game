// State of Spring Showdown as sent to clients. Plain `type`s so they are assignable to the core's ExternalState.

export type PogoItemKind = 'crate' | 'boots' | 'missile' | 'beam' | 'arrow' | 'mushroom' | 'tnt' | 'padlock';

export type PogoPlayerState = {
  id: string;
  /** tile the hop is heading to (or standing on) */
  c: number;
  r: number;
  /** tile the current hop started from */
  pc: number;
  pr: number;
  /** hop progress pc,pr -> c,r; 1 = landed */
  hop: number;
  /** facing: 0 up, 1 right, 2 down, 3 left */
  f: number;
  /** banked points */
  score: number;
  /** painted (not yet banked) tiles */
  tiles: number;
  item: '' | 'missile' | 'beam';
  /** speedy boots time left 1 -> 0 */
  boots: number;
  /** padlock time left 1 -> 0 */
  lock: number;
  stun: boolean;
  /** hit protection active (flicker) */
  inv: boolean;
  gone: boolean;
};

/**
 * Spring Showdown family. `tiles` is row-major, size*size, holding the index
 * (into `players`) of each tile's owner or -1.
 */
export type PogoState = {
  kind: 'ext:spring-showdown';
  variant: string;
  t: number;
  /** round length, s */
  limit: number;
  size: number;
  /** players cannot share a square (the `collisions` option) */
  solid?: boolean;
  tiles: number[];
  players: PogoPlayerState[];
  /** d = arrow direction mask: 1 up, 2 right, 4 down, 8 left; f = seconds until a TNT explodes */
  items: { id: number; c: number; r: number; k: PogoItemKind; d: number; f?: number }[];
  /** Spring Madness: squares a TNT blast reaches around it (1 = 3x3) */
  blast?: number;
  /** x,y in tile units (tile c spans [c, c+1)); dir like facing */
  missiles: { id: number; x: number; y: number; dir: number }[];
  /** Spring Rush: Zap Beams on screen, from tile c,r along facing d; f = 1 -> 0 as it fades (absent when none) */
  beams?: { c: number; r: number; d: number; f: number }[];
  /** Spring Madness: Blast Bot, in tile units, circling just outside the grid */
  boss?: { x: number; y: number };
};
