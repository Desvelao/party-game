// State of Tank Wars as sent to clients. Plain `type`s so they are assignable to the core's ExternalState.

export type TankPlayerState = {
  id: string;
  x: number;
  y: number;
  /** facing, radians */
  f: number;
  hp: number;
  alive: boolean;
  /** cannon type 0 balanced, 1 plasma, 2 spiky, 3 fireball */
  cannon: number;
  mines: number;
  /** shield meter 0..1 (Swamp Fox) */
  shield: number;
  /** shield currently raised */
  up: boolean;
  /** hit protection active (flicker) */
  inv: boolean;
  item: '' | 'bomb' | 'missile';
};

/** Tank Wars family (Desert / Metal / Jungle / Swamp Fox). Static geometry is in geometry.ts. */
export type TankState = {
  kind: 'ext:tank-wars';
  variant: string;
  t: number;
  /** round length, s */
  limit: number;
  maxHp: number;
  /** tanks drive on the corridor rails (the client draws them) */
  rails: boolean;
  /** width of the playable field in 80-unit squares (11 = the whole arena; Jungle Fox can be smaller) */
  size: number;
  players: TankPlayerState[];
  /** k: cannon shot or a missile's rocket; c = cannon type of the shot */
  shots: { id: number; x: number; y: number; f: number; k: 'shot' | 'rocket'; c: number }[];
  /** lobbed bombs: h = flight progress 0..1 */
  bombs: { id: number; x: number; y: number; h: number }[];
  /** fuse 1 -> 0 (fuse mines); -1 = armed, waiting for a tank (Swamp Fox) */
  mines: { id: number; x: number; y: number; fuse: number }[];
  /** land: falling 1 -> 0 before it can be taken */
  pickups: { id: number; x: number; y: number; k: 'fruit' | 'mine' | 'bomb' | 'missile'; land: number }[];
  /** short-lived explosion visuals; life 1 -> 0; rays = lengths up/right/down/left for fire mines */
  blasts: { id: number; x: number; y: number; r: number; rays?: number[]; life: number }[];
  /** Metal Fox: which metal walls are raised, and whether they are about to switch */
  walls?: { raised: boolean[]; warn: boolean };
  /** Jungle Fox: totem fall direction, warning 1 -> 0 (0 = idle) and the impact flash 1 -> 0 */
  totem?: { a: number; warn: number; hit: number };
};
