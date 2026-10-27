// What went wrong for the bot: knocked out, or a turn that ran out of time (the server played for it).
import type { Incident } from '../../../core/shared/ai';

export interface RingEntry {
  t: number;
  hp: number;
  guard: number;
  plan: string;
  hand: number[];
}

export function incident(cause: 'knocked-out' | 'turn-timeout', t: number, ring: RingEntry[], detail: Record<string, unknown> = {}): Incident {
  const last = ring[ring.length - 1];
  return {
    cause,
    t,
    summary: cause === 'knocked-out' ? `knocked out (last plan: ${last?.plan ?? '?'})` : 'the turn ran out before it played: the server picked the card',
    detail: { ...detail, ring: ring.slice(-12) },
  };
}
