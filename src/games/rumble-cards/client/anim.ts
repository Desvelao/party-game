// Pure helpers of the effects and animations (kept apart so they can be tested without a browser).
import { CARDS, type Motif } from '../shared/cards';

export interface Point {
  x: number;
  y: number;
}

/** True when the player asked their system for less motion: flights and shakes become plain fades. */
export function calm(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Which cards of `next` are new compared to `prev` (a drawn or stolen card), one flag per card of `next`. */
export function newCards(prev: number[], next: number[]): boolean[] {
  const have = new Map<number, number>();
  for (const c of prev) have.set(c, (have.get(c) ?? 0) + 1);
  return next.map((c) => {
    const n = have.get(c) ?? 0;
    if (n > 0) {
      have.set(c, n - 1);
      return false;
    }
    return true;
  });
}

/** Ease-out cubic of t in 0..1 (values outside are clamped). */
export function ease(t: number): number {
  const k = 1 - Math.min(1, Math.max(0, t));
  return 1 - k * k * k;
}

/** A point `t` (0..1) of the way from `from` to `to`, bowed sideways by up to `arc` units in the middle. */
export function along(from: Point, to: Point, t: number, arc: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * arc;
  return { x: from.x + dx * t - (dy / len) * bow, y: from.y + dy * t + (dx / len) * bow };
}

/** How urgent the turn timer looks: calm, running low (the last 10 s, or the second half of a short turn) or the final 5 s. */
export type TimerTone = 'ok' | 'warn' | 'urgent';

export function timerTone(tt: number, max: number): TimerTone {
  if (tt <= 5) return 'urgent';
  return tt <= Math.min(10, max / 2) ? 'warn' : 'ok';
}

/** Share of the turn left (0..1) for the ring round the player on turn; a missing length counts as the old 60 s. */
export function timerFraction(tt: number, max: number): number {
  return Math.min(1, Math.max(0, tt / (max > 0 ? max : 60)));
}

export type EffectKind = 'shot' | 'heal' | 'guard' | 'wave' | 'steal' | 'smash' | 'draw';

/** The colour of a card's effect, from its illustration. */
export const MOTIF_COLOR: Record<Motif, number> = {
  bolt: 0xffd23f,
  paw: 0xf6efe4,
  rock: 0xb3a79c,
  wall: 0xcf8a5e,
  shield: 0x4fc3ff,
  heart: 0xff5d73,
  swirl: 0x9be7ff,
  feather: 0xd8b8ff,
  eye: 0xb36bff,
  moon: 0xfff1a8,
  comet: 0x8fe1ff,
  stars: 0xfff1a8,
};

/** What a card looks like when it is played on the table: its kind of effect and colour. */
export function effectFor(card: number): { kind: EffectKind; color: number } {
  const def = CARDS[card];
  const has = (k: string) => def.fx.some((f) => f.k === k);
  let kind: EffectKind;
  if (has('all')) kind = 'wave';
  else if (has('smash')) kind = 'smash';
  else if (has('steal')) kind = 'steal';
  else if (has('dmg')) kind = 'shot';
  else if (has('heal')) kind = 'heal';
  else if (def.def) kind = 'guard';
  else kind = 'draw';
  const color = kind === 'heal' ? 0x2fbf71 : kind === 'guard' ? 0x4fc3ff : MOTIF_COLOR[def.art.m];
  return { kind, color };
}

/** Which rivals a card's direct damage reaches: the aimed one (`single`) and/or every rival (`all`). */
export function damageOf(card: number): { single: boolean; all: boolean } {
  const fx = CARDS[card].fx;
  return { single: fx.some((f) => f.k === 'dmg'), all: fx.some((f) => f.k === 'all') };
}

/** The direction (radians, `atan2` style: 0 is right, -PI/2 is up) from one point to another. */
export function angleToward(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** `steps` + 1 points along the arc a comet flies from `from` to `to` (eased, bowed sideways by up to `arc`). */
export function cometPath(from: Point, to: Point, steps: number, arc = 60): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) out.push(along(from, to, ease(i / steps), arc));
  return out;
}

/** Turn `current` towards `wanted` by at most `maxStep` radians, the short way round (never across the long side of +-PI). */
export function approach(current: number, wanted: number, maxStep: number): number {
  const d = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current));
  if (Math.abs(d) <= maxStep) return wanted;
  return current + Math.sign(d) * maxStep;
}
