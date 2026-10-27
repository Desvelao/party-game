import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared';

export function generateRoomCode(exists: (code: string) => boolean, rng: () => number = Math.random): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
    }
    if (!exists(code)) return code;
  }
  throw new Error('could not allocate a room code');
}
