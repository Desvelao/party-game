import { describe, expect, it } from 'vitest';
import { errorAction, voteOutcomeKey } from './flow';

const p = (spectate = false, code: string | undefined = 'ABCD') => ({ name: 'n', code, spectate });

describe('errorAction', () => {
  it('ROOM_CLOSED always resets', () => {
    expect(errorAction('ROOM_CLOSED', p(), 'ABCD')).toEqual({ kind: 'reset-menu', key: 'conn.closed' });
    expect(errorAction('ROOM_CLOSED', null, null)).toEqual({ kind: 'reset-menu', key: 'conn.closed' });
  });
  it('KICKED always resets, with the server text', () => {
    expect(errorAction('KICKED', null, 'ABCD')).toEqual({ kind: 'reset-menu-text' });
    expect(errorAction('KICKED', p(), null)).toEqual({ kind: 'reset-menu-text' });
  });
  it('toasts once joined', () => {
    expect(errorAction('ROOM_BUSY', p(), 'ABCD')).toEqual({ kind: 'toast' });
    expect(errorAction('X', null, 'ABCD')).toEqual({ kind: 'toast' });
  });
  it('falls back to spectating on busy/full', () => {
    expect(errorAction('ROOM_BUSY', p(), null)).toEqual({ kind: 'spectate-fallback' });
    expect(errorAction('ROOM_FULL', p(), null)).toEqual({ kind: 'spectate-fallback' });
  });
  it('does not retry when already spectating or no code', () => {
    expect(errorAction('ROOM_BUSY', p(true), null)).toEqual({ kind: 'reset-menu-text' });
    expect(errorAction('ROOM_FULL', { name: 'n', spectate: false }, null)).toEqual({ kind: 'reset-menu-text' });
  });
  it('reports unknown rooms with the code', () => {
    expect(errorAction('ROOM_NOT_FOUND', p(), null)).toEqual({ kind: 'reset-menu', key: 'conn.notFound', params: { code: 'ABCD' } });
    expect(errorAction('ROOM_NOT_FOUND', null, null)).toEqual({ kind: 'reset-menu-text' });
  });
  it('resets with the server text otherwise', () => {
    expect(errorAction('OTHER', null, null)).toEqual({ kind: 'reset-menu-text' });
  });
});

describe('voteOutcomeKey', () => {
  it('maps outcomes', () => {
    expect(voteOutcomeKey('passed', 'match')).toBe('vote.restartingMatch');
    expect(voteOutcomeKey('passed', 'round')).toBe('vote.restartingRound');
    expect(voteOutcomeKey('failed', 'match')).toBe('vote.failed');
    expect(voteOutcomeKey('cancelled', 'round')).toBe('vote.cancelled');
  });
});
