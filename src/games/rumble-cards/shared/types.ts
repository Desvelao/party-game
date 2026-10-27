import type { ExternalState } from '../../../core/shared/types';

export interface CardsPlayer {
  id: string;
  hero: number;
  hp: number;
  maxHp: number;
  /** cards in hand / deck / discard pile (the hand itself is private) */
  hand: number;
  deck: number;
  disc: number;
  /** Defense cards on the table: [card index, hit points left] */
  def: [number, number][];
  out: boolean;
}

export interface CardsState extends ExternalState {
  kind: 'ext:rumble-cards';
  players: CardsPlayer[];
  /** whose turn it is ('' once the round is over) */
  turn: string;
  /** cards played this turn, and how many more may be played */
  made: number;
  left: number;
  /** seconds left of the turn, and the length this turn was given */
  tt: number;
  ttMax: number;
  /** cards the player on turn still has to discard to get down to the hand limit (0 = none) */
  purge: number;
  /** the rival the player whose turn it is has aimed at ('' for none) */
  aim: string;
  /** the last card played: who, which card, against whom ('' for none); `n` counts plays so clients notice a new one */
  last: { p: string; c: number; tg: string; n: number } | null;
}

/** what only the player sees */
export interface CardsPrivate {
  hand: number[];
  /** the selected card (index in the hand) */
  cur: number;
}

/** what a player sends (GAME_ACTION) */
export type CardsAction = { a: 'play'; c: number; tg?: string } | { a: 'end' } | { a: 'discard'; c: number } | { a: 'sel'; c: number } | { a: 'aim'; tg: string };
