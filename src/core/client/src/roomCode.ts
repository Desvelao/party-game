import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared';

/**
 * What a room-code field should hold after typing or pasting: the code out of a pasted invite link
 * (`/room/ABCD`, `?room=ABCD`), else the text upper-cased with every character a code cannot contain removed.
 */
export function cleanRoomCodeInput(raw: string): string {
  const link = /\/room\/([A-Za-z0-9]+)/.exec(raw) ?? /[?&]room=([A-Za-z0-9]+)/.exec(raw);
  const source = link ? link[1]! : raw;
  let out = '';
  for (const ch of source.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === ROOM_CODE_LENGTH) break;
  }
  return out;
}
