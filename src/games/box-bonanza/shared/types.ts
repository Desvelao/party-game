// State of Box Bonanza as sent to clients. Plain `type`s so they are assignable to the core's ExternalState.

export type CrateKind = 'block' | 'locked' | 'tnt' | 'nitro';

export type CratePickupKind = 'berry' | 'mask' | 'boots' | 'z' | 'weight' | 'qbox';

export type CrateWeapon = 'ring' | 'missile' | 'orb';

export type CratePlayerState = {
  id: string;
  x: number;
  y: number;
  /** facing angle, radians */
  f: number;
  hp: number;
  alive: boolean;
  /** crate carried overhead */
  hold: '' | CrateKind;
  /** id of the crate a pick up would take right now, -1 when none / already holding */
  target: number;
  /** seconds left on a lit TNT crate being carried, -1 otherwise */
  holdFuse: number;
  /** Guardian mask time left 1 -> 0 (absorbs one hit) */
  mask: number;
  /** hit protection active (flicker) */
  inv: boolean;
  boots: number;
  /** Z (slow) time left 1 -> 0 */
  slow: number;
  /** weight countdown left 1 -> 0 (0 = none); at 0 the carrier dies */
  weight: number;
  weapon: '' | CrateWeapon;
  charges: number;
  /** spin-kick in progress */
  spin: boolean;
};

/** Box Bonanza family (Jungle / Space / Snow / Drain Bonanza). Arena = CRATE_ARENA. */
export type CrateState = {
  kind: 'ext:box-bonanza';
  variant: string;
  t: number;
  /** round length, s */
  limit: number;
  maxHp: number;
  /** seconds a lit TNT burns (full countdown) and how far its blast reaches (px) */
  tntFuse: number;
  blastRadius: number;
  /** seconds a weight carrier has (full countdown) */
  weightTime: number;
  /** floor grid size (0 = solid floor); holes is row-major, 1 = destroyed */
  tiles: number;
  holes: number[];
  players: CratePlayerState[];
  /** fuse: seconds left once lit, -1 unlit; moving = thrown/kicked */
  crates: { id: number; x: number; y: number; k: CrateKind; fuse: number; moving: boolean }[];
  pickups: { id: number; x: number; y: number; k: CratePickupKind }[];
  shots: { id: number; x: number; y: number; k: 'missile' | 'orb' | 'ring' }[];
  /** Snow Bonanza penguin */
  penguin?: { x: number; y: number; a: number; awake: boolean };
};
