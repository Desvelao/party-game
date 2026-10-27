import { describe, expect, it } from 'vitest';
import { cleanRoomCodeInput } from './roomCode';

describe('cleanRoomCodeInput', () => {
  it('upper-cases and drops spaces and punctuation', () => {
    expect(cleanRoomCodeInput(' ab-cd ')).toBe('ABCD');
  });
  it('drops characters a code never contains', () => {
    expect(cleanRoomCodeInput('a0o1b')).toBe('AB');
  });
  it('caps at the code length', () => {
    expect(cleanRoomCodeInput('ABCDEFG')).toBe('ABCD');
  });
  it('takes the code out of a pasted invite link', () => {
    expect(cleanRoomCodeInput('https://party.example/room/wxyz?spectate=1')).toBe('WXYZ');
    expect(cleanRoomCodeInput('https://party.example/?room=kmnp')).toBe('KMNP');
  });
  it('is empty for nothing usable', () => {
    expect(cleanRoomCodeInput('')).toBe('');
    expect(cleanRoomCodeInput('0 1 -')).toBe('');
  });
});
