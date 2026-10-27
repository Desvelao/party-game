import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION } from '../../shared';
import { resetSession, session } from './session';

describe('resetSession', () => {
  it('clears per-room state but keeps server config', () => {
    const config = { tickRate: 30, networkRate: 15, maxPlayers: 8, totalGames: 1 };
    Object.assign(session, {
      myId: 'a',
      code: 'ABCD',
      hostId: 'a',
      phase: 'playing',
      players: [{ id: 'a' }],
      spectator: true,
      spectators: 2,
      watchers: [{ id: 'w', name: 'w' }],
      locked: true,
      passwordProtected: true,
      password: 'pw',
      maxPlayers: 8,
      playingId: 'pong',
      vote: { kind: 'restart' },
      voteEndsAt: 5,
      config,
    });
    resetSession();
    expect(session.myId).toBe('');
    expect(session.code).toBe('');
    expect(session.hostId).toBe('');
    expect(session.phase).toBe('lobby');
    expect(session.players).toEqual([]);
    expect(session.watchers).toEqual([]);
    expect(session.password).toBeNull();
    expect(session.vote).toBeNull();
    expect(session.playingId).toBe('');
    expect(session.locked).toBe(false);
    expect(session.maxPlayers).toBe(0);
    expect(session.selection).toEqual(DEFAULT_SELECTION);
    expect(session.isHost).toBe(false);
    expect(session.config).toBe(config);
  });
});
