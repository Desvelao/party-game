// Rumble Cards: turn-based card duel, last hero standing. Rules follow the usual "draw 1, play at least
// 1 card" duel: damage hits Defense cards first, then hit points; reaching 0 hit points knocks you out.
import type { GameEvent, InputState } from '../../../core/shared/types';
import type { Minigame, MinigamePlayer, RawPlacement } from '../../../core/shared/plugin-api';
import { nextIn } from '../../../core/shared/kit/util';
import { CARDS, HEROES, deckOf, needsTarget, seatPos } from '../shared/cards';
import type { CardsPlayer, CardsPrivate, CardsState } from '../shared/types';
import { DEFAULT_CONFIG, type CardsConfig } from './config';

/** at most this many Defense cards stay on the table; the oldest goes when a new one comes */
export const MAX_DEFENSE = 5;
/** the last this many whole seconds of a turn tick */
const TICK_FROM = 5;

interface Seat {
  id: string;
  hero: number;
  hp: number;
  deck: number[];
  disc: number[];
  hand: number[];
  def: { c: number; h: number }[];
  out: boolean;
  /** knock-out batch: later = lasted longer; equal = knocked out together */
  seq: number;
  /** selected card in the hand, and the rival it will hit (moved with the cross, played with A) */
  cur: number;
  aim: string;
  /** previous input of this player, to tell a press from a hold */
  px: number;
  py: number;
  pa1: boolean;
  pa2: boolean;
}

/** -1, 0 or 1: how far a stick or cross is pushed */
const dir = (v: number): number => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);

export class RumbleCards implements Minigame {
  readonly id = 'rumble-cards';
  readonly name = 'Rumble Cards';

  private seats: Seat[] = [];
  private turnIdx = 0;
  private made = 0;
  private left = 1;
  private tt = 0;
  /** the length this turn was given, and the whole second last announced with a tick */
  private ttMax = 0;
  private tickAt = 0;
  /** cards the player on turn must still discard before the turn passes */
  private purge = 0;
  private t = 0;
  private turns = 0;
  private seqCounter = 0;
  private count = 0;
  private done = false;
  private events: GameEvent[] = [];
  private last: CardsState['last'] = null;
  private plays = 0;

  /** `heroes`: fixed hero per seat (tests and balance runs); by default they are dealt at random */
  constructor(private cfg: CardsConfig = DEFAULT_CONFIG, private rng: () => number = Math.random, private heroes?: number[]) {}

  init(players: MinigamePlayer[]): void {
    this.count = players.length;
    // heroes are dealt in a random order, so a seat does not always mean the same hero
    const heroes = this.heroes ?? HEROES.map((_, i) => i);
    if (!this.heroes) this.shuffle(heroes);
    this.seats = players.map((p, i) => {
      const hero = heroes[i % heroes.length];
      const deck = deckOf(hero);
      this.shuffle(deck);
      const seat: Seat = { id: p.id, hero, hp: this.cfg.hp, deck, disc: [], hand: [], def: [], out: false, seq: 0, cur: 0, aim: '', px: 0, py: 0, pa1: false, pa2: false };
      this.draw(seat, this.cfg.hand);
      return seat;
    });
    this.done = this.alive() <= 1;
    this.turnIdx = Math.floor(this.rng() * Math.max(1, this.seats.length));
    if (!this.done) this.beginTurn();
  }

  // ---- input ----------------------------------------------------------------

  /**
   * The standard controls: left/right pick a card, up/down pick the rival, A plays the card, B ends the turn.
   * Only presses count (not holds), and only on your own turn.
   */
  handleInput(playerId: string, input: InputState): void {
    const s = this.seats.find((x) => x.id === playerId);
    if (!s) return;
    const dx = dir(input.mx);
    const dy = dir(input.my);
    const moveX = dx !== 0 && dx !== s.px;
    const moveY = dy !== 0 && dy !== s.py;
    const a = input.a1 && !s.pa1;
    const b = input.a2 && !s.pa2;
    s.px = dx;
    s.py = dy;
    s.pa1 = input.a1;
    s.pa2 = input.a2;
    if (this.current() !== s) return;
    if (moveX && s.hand.length > 0) s.cur = (s.cur + dx + s.hand.length) % s.hand.length;
    if (moveY) this.cycleAim(s, dy);
    if (this.purge > 0) {
      if (a) this.discardCard(s, s.cur, false);
      return;
    }
    if (a) this.play(s, s.cur, s.aim);
    else if (b && this.made >= 1) this.endTurn();
  }

  handleAction(playerId: string, data: Record<string, unknown>): void {
    const s = this.current();
    if (!s || s.id !== playerId) return;
    if (data.a === 'end') {
      if (this.made >= 1 && this.purge === 0) this.endTurn();
      return;
    }
    if (data.a === 'discard') {
      if (this.purge > 0 && typeof data.c === 'number' && Number.isInteger(data.c)) this.discardCard(s, data.c, false);
      return;
    }
    if (data.a === 'sel') {
      if (typeof data.c === 'number' && Number.isInteger(data.c) && data.c >= 0 && data.c < s.hand.length) s.cur = data.c;
      return;
    }
    if (data.a === 'aim') {
      if (typeof data.tg === 'string' && this.opponents(s).some((x) => x.id === data.tg)) s.aim = data.tg;
      return;
    }
    if (data.a !== 'play' || this.purge > 0 || typeof data.c !== 'number' || !Number.isInteger(data.c)) return;
    this.play(s, data.c, typeof data.tg === 'string' ? data.tg : '');
  }

  removePlayer(playerId: string): void {
    const s = this.seats.find((x) => x.id === playerId);
    if (!s || s.out) return;
    const wasTurn = this.current() === s;
    this.knockOut([s]);
    if (this.done) return;
    if (wasTurn) this.nextTurn();
  }

  // ---- simulation -------------------------------------------------------------

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    this.tt -= dt;
    const s = this.current();
    if (!s) return;
    if (this.tt > 0) {
      // the last seconds: one tick per whole second, for everyone to hear and see
      const sec = Math.ceil(this.tt);
      if (sec <= TICK_FROM && sec < this.tickAt && this.ttMax > TICK_FROM) this.emit('ext:tick', s, sec);
      this.tickAt = Math.min(this.tickAt, sec);
      return;
    }
    // out of time: play something sensible if nothing was played yet, then pass; extra cards go at random
    if (this.purge === 0 && this.made === 0 && s.hand.length > 0) this.autoPlay(s);
    if (!this.done && this.current() === s) this.endTurn(true);
  }

  private current(): Seat | null {
    return this.done ? null : this.seats[this.turnIdx] ?? null;
  }

  private alive(): number {
    let n = 0;
    for (const s of this.seats) if (!s.out) n++;
    return n;
  }

  private shuffle(a: number[]): void {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  private draw(s: Seat, n: number): void {
    for (let i = 0; i < n; i++) {
      if (s.deck.length === 0) {
        s.deck = s.disc;
        s.disc = [];
        this.shuffle(s.deck);
        if (s.deck.length === 0) return;
      }
      s.hand.push(s.deck.pop()!);
    }
  }

  /** Start the turn of the seat at `turnIdx` (the hand was refilled when the last turn ended); with nothing to play the turn passes at once. */
  private beginTurn(): void {
    for (let guard = 0; guard <= this.seats.length; guard++) {
      const s = this.seats[this.turnIdx];
      this.made = 0;
      this.left = 1;
      this.tt = this.ttMax = nextIn(this.rng, this.cfg.turnSeconds, this.cfg.turnVariance, 5);
      this.tickAt = Infinity;
      this.purge = 0;
      s.cur = 0;
      s.aim = this.opponents(s)[0]?.id ?? '';
      if (s.hand.length > 0) return;
      this.turns++;
      if (this.turns >= this.cfg.maxTurns * this.count) return this.finish();
      this.stepIdx();
    }
    this.finish(); // nobody can play any more
  }

  private stepIdx(): void {
    do this.turnIdx = (this.turnIdx + 1) % this.seats.length;
    while (this.seats[this.turnIdx].out);
  }

  /**
   * The player is done. Over the hand limit they must discard first (they pick, the turn stays theirs);
   * `force` (out of time) discards random cards at once.
   */
  private endTurn(force = false): void {
    const s = this.current();
    if (s) {
      const over = s.hand.length - this.cfg.maxHand;
      if (over > 0) {
        if (!force) {
          this.purge = over;
          s.cur = Math.min(s.cur, s.hand.length - 1);
          return;
        }
        for (let i = 0; i < over; i++) this.discardCard(s, Math.floor(this.rng() * s.hand.length), true);
      }
    }
    this.finishTurn();
  }

  /** throw card `i` of the hand on the discard pile; a chosen discard counts down the purge and passes the turn at the limit */
  private discardCard(s: Seat, i: number, auto: boolean): void {
    if (i < 0 || i >= s.hand.length) return;
    const card = s.hand.splice(i, 1)[0];
    s.disc.push(card);
    s.cur = Math.min(s.cur, Math.max(0, s.hand.length - 1));
    this.emit('ext:discard', s, undefined, { c: card, auto });
    if (auto) return;
    if (--this.purge <= 0) {
      this.purge = 0;
      this.finishTurn();
    }
  }

  /** The turn is over: the hand is refilled up to the limit (it never grows past it here), then the next player. */
  private finishTurn(): void {
    const s = this.current();
    if (s && s.hand.length < this.cfg.maxHand) this.draw(s, this.cfg.maxHand - s.hand.length);
    this.turns++;
    if (this.turns >= this.cfg.maxTurns * this.count) return this.finish();
    this.nextTurn();
  }

  private nextTurn(): void {
    this.stepIdx();
    this.beginTurn();
  }

  private finish(): void {
    this.done = true;
  }

  /** move the aimed rival to the next (`step` 1) or previous (-1) living rival */
  private cycleAim(s: Seat, step: number): void {
    const foes = this.opponents(s);
    if (foes.length === 0) return;
    const i = foes.findIndex((f) => f.id === s.aim);
    s.aim = foes[(i + step + foes.length) % foes.length].id;
  }

  /** opponents a card of `s` may hit: everyone still in, except `s` */
  private opponents(s: Seat): Seat[] {
    return this.seats.filter((x) => x !== s && !x.out);
  }

  /** Pick a card and a target for a player who did not choose (timeout). */
  private autoPlay(s: Seat): void {
    const foes = this.opponents(s);
    if (foes.length === 0 || s.hand.length === 0) return;
    const weakest = foes.reduce((a, b) => (this.guard(b) < this.guard(a) ? b : a));
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < s.hand.length; i++) {
      const sc = this.score(s, s.hand[i], weakest);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    this.play(s, best, weakest.id);
  }

  /** what the history shows after a change: the hit points and the total Defense a player has now */
  private balance(s: Seat): { hp: number; sh: number } {
    let sh = 0;
    for (const d of s.def) sh += d.h;
    return { hp: s.hp, sh };
  }

  /** hit points plus Defense: what damage has to get through */
  private guard(s: Seat): number {
    let n = s.hp;
    for (const d of s.def) n += d.h;
    return n;
  }

  private score(s: Seat, card: number, foe: Seat): number {
    let sc = 0;
    const low = s.hp <= Math.ceil(this.cfg.hp / 2);
    for (const f of CARDS[card].fx) {
      if (f.k === 'dmg') sc += f.n * (foe.hp <= f.n ? 4 : 2);
      else if (f.k === 'all') sc += f.n * 2 * this.opponents(s).length;
      else if (f.k === 'heal') sc += s.hp < this.cfg.hp ? (low ? 4 : 1) : -1;
      else if (f.k === 'draw') sc += 1;
      else if (f.k === 'play') sc += 1.5;
      else if (f.k === 'steal') sc += foe.hand.length > 0 ? 1.5 : -1;
      else if (f.k === 'smash') sc += foe.def.length > 0 ? 2.5 : -1;
    }
    if (CARDS[card].def) sc += low ? 3 : 1.2;
    return sc;
  }

  private play(s: Seat, handIdx: number, targetId: string): void {
    if (handIdx < 0 || handIdx >= s.hand.length) return;
    const card = s.hand[handIdx];
    const def = CARDS[card];
    const foes = this.opponents(s);
    let target: Seat | undefined;
    if (needsTarget(card)) {
      target = foes.find((x) => x.id === targetId) ?? (foes.length === 1 ? foes[0] : undefined);
      if (!target) return; // the player has to say whom
      s.aim = target.id; // the rival a card was thrown at is the new aim, for everyone to see
    } else if (def.fx.some((f) => f.k === 'all') && foes.length === 0) return;

    s.hand.splice(handIdx, 1);
    // first, so the clients hear and see the cast before the hits and heals it causes
    this.emit('ext:play', s, undefined, { c: card, tg: target?.id ?? '' });
    let extra = 0;
    const hurt: Seat[] = [];
    for (const f of def.fx) {
      if (f.k === 'dmg' && target) this.damage(target, f.n, hurt);
      else if (f.k === 'all') for (const x of foes) this.damage(x, f.n, hurt);
      else if (f.k === 'heal') {
        const before = s.hp;
        s.hp = Math.min(this.cfg.hp, s.hp + f.n);
        if (s.hp > before) this.emit('heal', s, s.hp - before, this.balance(s));
      } else if (f.k === 'draw') this.draw(s, f.n);
      else if (f.k === 'play') extra += f.n;
      else if (f.k === 'steal' && target && target.hand.length > 0) {
        const i = Math.floor(this.rng() * target.hand.length);
        s.hand.push(target.hand.splice(i, 1)[0]);
      } else if (f.k === 'smash' && target && target.def.length > 0) {
        target.disc.push(target.def.shift()!.c);
        this.emit('ext:break', target);
      }
    }
    if (def.def) {
      s.def.push({ c: card, h: def.def });
      if (s.def.length > MAX_DEFENSE) s.disc.push(s.def.shift()!.c);
      this.emit('ext:guard', s);
    } else s.disc.push(card);

    this.made++;
    this.left += extra - 1;
    this.last = { p: s.id, c: card, tg: target?.id ?? '', n: ++this.plays };

    const down = hurt.filter((x, i) => x.hp <= 0 && hurt.indexOf(x) === i);
    if (down.length > 0) this.knockOut(down);
    if (this.done) return;
    s.cur = Math.min(s.cur, Math.max(0, s.hand.length - 1));
    if (!this.opponents(s).some((x) => x.id === s.aim)) s.aim = this.opponents(s)[0]?.id ?? '';
    if (this.left <= 0 || s.hand.length === 0) this.endTurn();
  }

  /** damage goes into Defense cards first (oldest first), the rest into hit points */
  private damage(v: Seat, n: number, hurt: Seat[]): void {
    let absorbed = 0;
    while (n > 0 && v.def.length > 0) {
      const d = v.def[0];
      const take = Math.min(n, d.h);
      d.h -= take;
      n -= take;
      absorbed += take;
      if (d.h <= 0) v.disc.push(v.def.shift()!.c);
    }
    if (absorbed > 0) this.emit('ext:block', v, absorbed, this.balance(v));
    if (n <= 0) return;
    const lost = Math.min(n, v.hp);
    v.hp -= lost;
    hurt.push(v);
    this.emit('hit', v, lost, this.balance(v));
  }

  private knockOut(list: Seat[]): void {
    const seq = ++this.seqCounter;
    for (const s of list) {
      s.out = true;
      s.seq = seq;
      s.hp = 0;
      s.disc.push(...s.hand, ...s.def.map((d) => d.c));
      s.hand = [];
      s.def = [];
      this.emit('eliminated', s);
    }
    if (this.alive() <= 1) this.finish();
  }

  /** `n`: an amount the client shows (hit points lost or recovered, damage absorbed); `extra`: more fields (the card of a cast). Neither is part of the typed GameEvent */
  private emit(kind: GameEvent['kind'], s: Seat, n?: number, extra?: Record<string, unknown>): void {
    const p = seatPos(this.seats.indexOf(s), this.seats.length);
    this.events.push({ kind, id: s.id, x: Math.round(p.x), y: Math.round(p.y), ...(n !== undefined ? { n } : {}), ...extra } as GameEvent);
  }

  // ---- views --------------------------------------------------------------------

  getState(): CardsState {
    const cur = this.current();
    const players: CardsPlayer[] = this.seats.map((s) => ({
      id: s.id,
      hero: s.hero,
      hp: s.hp,
      maxHp: this.cfg.hp,
      hand: s.hand.length,
      deck: s.deck.length,
      disc: s.disc.length,
      def: s.def.map((d): [number, number] => [d.c, d.h]),
      out: s.out,
    }));
    return {
      kind: 'ext:rumble-cards',
      t: Math.round(this.t * 10) / 10,
      players,
      turn: cur?.id ?? '',
      made: this.made,
      left: Math.max(0, this.left),
      tt: Math.max(0, Math.round(this.tt * 10) / 10),
      ttMax: Math.round(this.ttMax * 10) / 10,
      purge: this.purge,
      aim: cur?.aim ?? '',
      last: this.last,
    };
  }

  /** a player's own hand */
  getPrivateState(playerId: string): CardsPrivate | null {
    const s = this.seats.find((x) => x.id === playerId);
    return s ? { hand: s.hand.slice(), cur: s.cur } : null;
  }

  drainEvents(): GameEvent[] {
    return this.events.splice(0);
  }

  isFinished(): boolean {
    return this.done;
  }

  getStats(): Record<string, Record<string, number>> {
    return Object.fromEntries(this.seats.map((s) => [s.id, { hp: s.hp }]));
  }

  /** survivors by hit points, then the knocked-out by how long they lasted; equal rank shares a place */
  getPlacements(): RawPlacement[] {
    const key = (s: Seat) => (s.out ? s.seq : 1000 + s.hp);
    return this.seats.map((s) => ({ id: s.id, place: 1 + this.seats.filter((q) => key(q) > key(s)).length }));
  }
}
