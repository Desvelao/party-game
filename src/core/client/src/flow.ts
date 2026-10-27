import type { MessageKey } from '../../shared';

export interface PendingJoin {
  name: string;
  code?: string;
  spectate: boolean;
  password?: string;
}

/** What to do with a server ERROR message. */
export type ErrorAction =
  | { kind: 'reset-menu'; key: 'conn.closed' }
  | { kind: 'spectate-fallback' }
  | { kind: 'ask-password'; wrong: boolean }
  | { kind: 'reset-menu'; key: 'conn.notFound'; params: { code: string } }
  | { kind: 'reset-menu-text' }
  | { kind: 'toast' };

export function errorAction(code: string, pending: PendingJoin | null, sessionCode: string | null | undefined): ErrorAction {
  if (code === 'ROOM_CLOSED') return { kind: 'reset-menu', key: 'conn.closed' };
  // removed by the host: leave the room screen even though we are "in" it
  if (code === 'KICKED' || code === 'BANNED') return { kind: 'reset-menu-text' };
  if (sessionCode) return { kind: 'toast' };
  if (pending?.code && (code === 'PASSWORD_REQUIRED' || code === 'WRONG_PASSWORD')) {
    return { kind: 'ask-password', wrong: code === 'WRONG_PASSWORD' };
  }
  // joining as a player failed because the match runs / room is full: watch instead
  if (pending?.code && !pending.spectate && (code === 'ROOM_BUSY' || code === 'ROOM_FULL')) {
    return { kind: 'spectate-fallback' };
  }
  if (pending?.code && code === 'ROOM_NOT_FOUND') {
    return { kind: 'reset-menu', key: 'conn.notFound', params: { code: pending.code } };
  }
  return { kind: 'reset-menu-text' };
}

/** Toast message key for a finished vote. */
export function voteOutcomeKey(outcome: string, kind: string | undefined): MessageKey {
  return outcome === 'passed'
    ? kind === 'change'
      ? 'vote.backToLobby'
      : kind === 'match' || kind === 'again'
        ? 'vote.restartingMatch'
        : 'vote.restartingRound' : outcome === 'failed' ? 'vote.failed' : 'vote.cancelled';
}
