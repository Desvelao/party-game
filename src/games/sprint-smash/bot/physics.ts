// What the bot knows of Sprint Smash: the server's own constants (imported, so the two cannot drift) and the polar
// frame of the ring track (laps run towards increasing angle).
import { DASH_CX, DASH_CY, DASH_INNER, DASH_MID, DASH_OUTER, DASH_ROD_HALF, DASH_ROD_LEN } from '../shared/geometry';
import { PLAYER_R } from '../server/SprintSmash';

export { ACCEL_SPEED, BALL_R, BARREL_R, BLOB_R, BOOST_SPEED, CRUISE, JUMP_COOLDOWN, JUMP_TIME, MISSILE_R, MISSILE_SPEED, PICKUP_R, PLAYER_R, ROD_HIT, STAR_RADIUS, TURN_RATE } from '../server/SprintSmash';
export { DASH_CX, DASH_CY, DASH_INNER, DASH_MID, DASH_OUTER, DASH_ROD_HALF, DASH_ROD_LEN };

/** the band a craft's centre stays in (the server clamps it there) */
export const R_LO = DASH_INNER + PLAYER_R * 0.6;
export const R_HI = DASH_OUTER - PLAYER_R * 0.6;

export const wrap = (a: number): number => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  else if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

export const polar = (x: number, y: number): { a: number; r: number } => ({ a: Math.atan2(y - DASH_CY, x - DASH_CX), r: Math.hypot(x - DASH_CX, y - DASH_CY) });
export const point = (a: number, r: number): { x: number; y: number } => ({ x: DASH_CX + Math.cos(a) * r, y: DASH_CY + Math.sin(a) * r });
