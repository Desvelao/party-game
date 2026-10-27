/**
 * Sprint Smash arena (world units, WORLD_SIZE = 1000): a ring track around the
 * centre. Shared so the server simulation and the client renderer agree.
 */
export const DASH_CX = 500;
export const DASH_CY = 500;
/** track edges: crafts stay between them */
export const DASH_INNER = 260;
export const DASH_OUTER = 400;
/** centre line of the track */
export const DASH_MID = (DASH_INNER + DASH_OUTER) / 2;
/** rods reach across the whole track from the centre */
export const DASH_ROD_LEN = DASH_OUTER;
export const DASH_ROD_HALF = 14;
/**
 * Dot Sprint: the outer edge is a wall only between 10 and 2 o'clock (through 12); everywhere else the
 * track is open and a craft that leaves it falls. Angles are atan2 radians (y down), so the arc is -150..-30 deg.
 */
export const DASH_WALL_FROM = (-5 * Math.PI) / 6;
export const DASH_WALL_TO = -Math.PI / 6;
export const inWallArc = (ang: number): boolean => ang >= DASH_WALL_FROM && ang <= DASH_WALL_TO;
