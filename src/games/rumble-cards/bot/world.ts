// Turns a Rumble Cards snapshot (and our private hand) into the bot's view: whose turn, our hand and selection, the
// order the aim cycles through (every other player still in, in seat order: teammates too), and the rivals.
import type { CardsPlayer, CardsPrivate, CardsState } from '../shared/types';
import { CARDS, HEROES, deckOf } from '../shared/cards';

export interface World {
  tick: number;
  recvMs: number;
  state: CardsState;
  me: CardsPlayer | null;
  myTurn: boolean;
  hand: number[];
  cur: number;
  /** what the aim cycles through, in order */
  others: CardsPlayer[];
  /** others that are not teammates */
  foes: CardsPlayer[];
  allies: Set<string>;
}

/** average damage per card of a hero's deck (to one target): the threat a rival's hand holds */
export const DMG_PER_CARD: number[] = HEROES.map((_, h) => {
  const d = deckOf(h);
  let sum = 0;
  for (const c of d) for (const f of CARDS[c].fx) if (f.k === 'dmg' || f.k === 'all') sum += f.n;
  return sum / d.length;
});

export function guard(p: CardsPlayer): number {
  let n = p.hp;
  for (const [, h] of p.def) n += h;
  return n;
}

export class WorldModel {
  private priv: CardsPrivate | null = null;

  constructor(private readonly selfId: string, private readonly allies: ReadonlySet<string>) {}

  setPrivate(p: CardsPrivate | null): void {
    this.priv = p;
  }

  update(s: CardsState, tick: number, recvMs: number): World {
    const me = s.players.find((p) => p.id === this.selfId) ?? null;
    const others = s.players.filter((p) => p.id !== this.selfId && !p.out);
    return {
      tick,
      recvMs,
      state: s,
      me,
      myTurn: s.turn === this.selfId,
      hand: this.priv?.hand ?? [],
      cur: this.priv?.cur ?? 0,
      others,
      foes: others.filter((p) => !this.allies.has(p.id)),
      allies: new Set(this.allies),
    };
  }
}
