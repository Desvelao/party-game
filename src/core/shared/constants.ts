export const PROTOCOL_VERSION = 1;

export const MAX_NAME_LENGTH = 16;
/** Longest player id accepted in KICK / MAKE_HOST / RESET_NAME (server ids are 6 hex chars). */
export const MAX_ID_LENGTH = 16;
/** Largest maxPlayers a client may request in ROOM_SETTINGS (the server config clamps lower). */
export const MAX_ROOM_PLAYERS = 64;
export const ROOM_CODE_LENGTH = 4;
// No 0/O/1/I to keep codes unambiguous when read aloud.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Any client message larger than this is dropped / connection closed. */
export const MAX_MESSAGE_BYTES = 8192;

export const WORLD_SIZE = 1000;
export const COUNTDOWN_SECONDS = 3;
export const RESULTS_SECONDS = 8;

/** Match points by finishing place (1-based). Places past the table score 0. */
export const PLACEMENT_POINTS = [10, 7, 5, 4, 3, 2, 1];
export function placementPoints(place: number): number {
  return PLACEMENT_POINTS[place - 1] ?? 0;
}

/** Quick reactions a player or spectator can send (by index); labels are the `emote.<n>` locale keys. */
export const EMOTES = ['👍', '👏', '😂', '😮', '🔥', '😢'] as const;

/** Most teams a room can split into. */
export const MAX_TEAMS = 4;
/** Team colours (0xRRGGBB), by team index: red, blue, green, yellow. */
export const TEAM_PALETTE = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835];

/** Version of this core, checked against a plugin's `engines.core` (kept equal to package.json; see constants.test.ts). */
export const CORE_VERSION = '0.1.0';
