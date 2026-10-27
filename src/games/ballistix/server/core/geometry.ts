import { FIELD_HALF } from '../../shared/geometry';
import { WORLD_SIZE } from '../../../../core/shared/constants';

// ---- field geometry (shared by the core rules and every variant module) ------

export const C = WORLD_SIZE / 2;
export const H = FIELD_HALF;
/** thickness of a paddle, perpendicular to its side */
export const PADDLE_T = 20;

// ---- tuning shared by all variants ------------------------------------------

export const PADDLE_SPEED = 620;
export const PADDLE_RESPONSE = 14; // 1/s
/** Seconds the boost pulse stays visible (the push itself is instant). */
export const PULSE_TIME = 0.45;
/** Seconds for a smashed ball to ease back to normal speed limits. */
export const BOOST_DECAY = 1.8;
/** Launch direction spread around the corner->centre diagonal (radians, +-). */
export const LAUNCH_SPREAD = (28 * Math.PI) / 180;
/** Max deflection angle off a paddle. */
export const MAX_ANGLE = (62 * Math.PI) / 180;
/** Side assignment order: 2 players face each other, 3 get a "U". */
export const SIDE_ORDER = [0, 2, 1, 3];

// ---- helpers -----------------------------------------------------------------

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export { mulberry32 } from '../../../../core/shared/kit/util';
