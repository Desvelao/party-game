// The Rumble Cards policy: picks the next play of the turn. Extra-play cards come first (they cost no play), then a
// finishing blow if one is in hand, then the best of: damage (on the weakest rival, or the leader), hits on everyone
// (minus teammates hit), heals and Defense (each hit point they keep is one the rivals must take again, plus the
// damage the rivals' hands are expected to deal before our next turn), smash on a rival hiding behind Defense, steal. With `lookahead` 0 it scores like the server's
// timeout pick. A heal at full health is never worth it: it ends the turn instead.
import { CARDS, needsTarget } from '../../shared/cards';
import type { CardsPlayer } from '../../shared/types';
import { MAX_DEFENSE } from '../../server/RumbleCards';
import { DMG_PER_CARD, guard, type World } from '../world';
import type { Plan, Policy } from './types';

export class PlannerPolicy implements Policy {
  constructor(private readonly P: Record<string, number>, private readonly rng: () => number) {}

  next(w: World): Plan | null {
    const me = w.me;
    if (!w.myTurn || !me || me.out || !w.hand.length) return null;
    const P = this.P;
    if (w.state.purge > 0) return this.discard(w, me);
    const plays: { card: number; target: string; value: number; why: string }[] = [];
    for (let i = 0; i < w.hand.length; i++) {
      const c = w.hand[i];
      if (needsTarget(c)) {
        for (const t of w.others) plays.push({ card: i, target: t.id, ...this.value(w, me, c, t) });
      } else plays.push({ card: i, target: '', ...this.value(w, me, c, null) });
    }
    // ties go to a random one (else every bot would pick the first rival in seat order)
    for (const p of plays) p.value += this.rng() * 1e-3;
    {
    }
    if (!plays.length) return null;
    if (this.rng() < P.mistake) {
      const p = plays[Math.floor(this.rng() * plays.length)];
      return { kind: 'play', ...p, why: 'mistake' };
    }
    let best = plays[0];
    for (const p of plays) if (p.value > best.value) best = p;
    // nothing worth playing after the first card: keep the hand
    if (best.value < 0 && w.state.made >= 1) return { kind: 'end', why: 'nothing worth it' };
    return { kind: 'play', ...best };
  }

  /** over the hand limit: throw away the card that is worth least to play (a random one on a mistake) */
  private discard(w: World, me: CardsPlayer): Plan {
    if (this.rng() < this.P.mistake) return { kind: 'discard', card: Math.floor(this.rng() * w.hand.length), why: 'mistake' };
    let worst = 0;
    let worstValue = Infinity;
    for (let i = 0; i < w.hand.length; i++) {
      const c = w.hand[i];
      let best = -Infinity;
      if (needsTarget(c)) for (const t of w.others) best = Math.max(best, this.value(w, me, c, t).value);
      else best = this.value(w, me, c, null).value;
      best += this.rng() * 1e-3;
      if (best < worstValue) {
        worstValue = best;
        worst = i;
      }
    }
    return { kind: 'discard', card: worst, why: 'least useful' };
  }

  /** expected damage coming at us before our next turn: each rival with cards plays about 1.3 of them */
  private threat(w: World): number {
    let t = 0;
    for (const f of w.foes) if (f.hand + f.deck > 0) t += DMG_PER_CARD[f.hero] * 1.3;
    return t;
  }

  private value(w: World, me: CardsPlayer, card: number, t: CardsPlayer | null): { value: number; why: string } {
    const P = this.P;
    const def = CARDS[card];
    const full = me.hp >= me.maxHp;
    const low = me.hp <= Math.ceil(me.maxHp / 2);
    const ally = t ? w.allies.has(t.id) : false;
    const smart = P.lookahead > 0;
    let v = 0;
    let why = '';
    for (const f of def.fx) {
      if (f.k === 'dmg' && t) {
        if (ally) {
          v -= 10;
          continue;
        }
        const g = guard(t);
        const kill = g <= f.n;
        // the race: a hit point (or a point of Defense) taken off is worth what one kept is (2.2), a knock-out more
        v += smart ? f.n * 2.2 + (kill ? 8 : 0) : f.n * (t.hp <= f.n ? 4 : 2);
        if (smart) {
          // focus: the weakest (lowest guard) or the leader (most hit points)
          const weakest = w.foes.every((o) => guard(o) >= g);
          const leader = w.foes.every((o) => o.hp <= t.hp);
          v += (weakest ? 1 - P.focusLeader : 0) + (leader ? P.focusLeader : 0);
        }
        if (kill) why = 'finish';
      } else if (f.k === 'all') {
        let hit = 0;
        for (const o of w.others) {
          if (w.allies.has(o.id)) v -= smart ? 3 : 0;
          else {
            hit++;
            if (smart && guard(o) <= f.n) v += 8;
          }
        }
        v += f.n * 2 * hit;
      } else if (f.k === 'heal') {
        if (full) v -= 3;
        // a hit point back is a hit point in the race, more so when low and when a lot is coming
        else v += smart ? (Math.min(f.n, me.maxHp - me.hp) * 2 + (low ? 1.5 : 0) + this.threat(w) * 0.3) * P.defense : low ? 4 : 1;
      } else if (f.k === 'draw') v += smart ? 1.4 : 1;
      else if (f.k === 'play') {
        // costs no play: first, always
        v += smart && P.extraFirst ? 6 : 1.5;
        why = why || 'extra play';
      } else if (f.k === 'steal' && t) v += ally ? -2 : t.hand > 0 ? 1.5 : -0.5;
      else if (f.k === 'smash' && t) v += ally ? -2 : t.def.length > 0 ? 2 + t.def[0][1] * (smart ? 1 : 0.5) : -0.5;
    }
    if (def.def) {
      if (smart) {
        const crowd = me.def.length >= MAX_DEFENSE ? 0.4 : 1;
        // Defense stays until it is used up: worth its hit points, plus a little for the damage on its way
        v += (def.def * 2.2 + (low ? 1.5 : 0) + Math.min(def.def, this.threat(w)) * 0.5) * P.defense * crowd;
      } else v += low ? 3 : 1.2;
      why = why || 'defense';
    }
    return { value: v, why: why || 'best' };
  }
}
