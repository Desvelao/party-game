// The history of the plays of a round: who cast which card and how it changed hit points and Defense. Built on each
// client from the game's own events (a cast starts an entry, the hits, blocks and heals it causes follow in the same
// batch), so it costs the server nothing. Pure and shared by the table and the phones.
import { CARDS } from '../shared/cards';

/** what one play did to one player */
export interface Change {
  /** hit points gained (+) or lost (-), Defense points gained or lost, Defense cards destroyed */
  hp: number;
  sh: number;
  broke: number;
  out: boolean;
  /** the totals after the last change, when the server said */
  hpNow?: number;
  shNow?: number;
}

export interface Entry {
  /** counts up from 1 within a round */
  n: number;
  kind: 'play' | 'discard';
  /** who played or discarded, and the card */
  p: string;
  c: number;
  /** the rival aimed at ('' for none) */
  tg: string;
  /** a card taken at random because the time ran out */
  auto: boolean;
  /** the players it changed, in the order it happened */
  changes: Record<string, Change>;
}

/** the parts of a game event the history reads */
export interface LogEvent {
  kind: string;
  id: string;
  n?: number;
  c?: number;
  tg?: string;
  auto?: boolean;
  hp?: number;
  sh?: number;
}

const KEEP = 40;

export class PlayLog {
  private list: Entry[] = [];
  private seq = 0;
  private subs = new Set<() => void>();

  entries(): readonly Entry[] {
    return this.list;
  }

  reset(): void {
    this.list = [];
    this.seq = 0;
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private notify(): void {
    for (const fn of this.subs) fn();
  }

  private change(e: Entry, id: string, ev: LogEvent): Change {
    const ch = (e.changes[id] ??= { hp: 0, sh: 0, broke: 0, out: false });
    if (typeof ev.hp === 'number') ch.hpNow = ev.hp;
    if (typeof ev.sh === 'number') ch.shNow = ev.sh;
    return ch;
  }

  /** feed every event in order; the ones that are not about plays are ignored */
  add(ev: LogEvent): void {
    const cur = this.list[this.list.length - 1];
    const amount = Math.max(0, Number(ev.n) || 0);
    switch (ev.kind) {
      case 'ext:play': {
        const c = Number(ev.c);
        if (!CARDS[c]) return;
        this.list.push({ n: ++this.seq, kind: 'play', p: ev.id, c, tg: ev.tg ?? '', auto: false, changes: {} });
        if (this.list.length > KEEP) this.list.shift();
        break;
      }
      case 'ext:discard': {
        const c = Number(ev.c);
        if (!CARDS[c]) return;
        this.list.push({ n: ++this.seq, kind: 'discard', p: ev.id, c, tg: '', auto: !!ev.auto, changes: {} });
        if (this.list.length > KEEP) this.list.shift();
        break;
      }
      case 'hit':
        if (cur?.kind === 'play') this.change(cur, ev.id, ev).hp -= amount;
        else return;
        break;
      case 'heal':
        if (cur?.kind === 'play') this.change(cur, ev.id, ev).hp += amount;
        else return;
        break;
      case 'ext:block':
        if (cur?.kind === 'play') this.change(cur, ev.id, ev).sh -= amount;
        else return;
        break;
      case 'ext:break':
        if (cur?.kind === 'play') this.change(cur, ev.id, ev).broke++;
        else return;
        break;
      case 'ext:guard':
        // a Defense card was put on the table: the caster's Defense grows by its points
        if (cur?.kind === 'play' && cur.p === ev.id) this.change(cur, ev.id, ev).sh += CARDS[cur.c].def ?? 0;
        else return;
        break;
      case 'eliminated':
        if (cur?.kind === 'play') this.change(cur, ev.id, ev).out = true;
        else return;
        break;
      default:
        return;
    }
    this.notify();
  }
}

/** the one log of the round, shared by the table overlay and the phone controls */
export const playLog = new PlayLog();
