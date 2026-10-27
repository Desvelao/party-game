// The table: every seat with its hero, hit points, Defense cards and cards in hand; the turn is ringed.
import type { ClientContext, GameRenderer } from '../../../core/client/src/plugins/api';
import type Phaser from 'phaser';
import { HEROES, seatPos } from '../shared/cards';
import { along, angleToward, approach, calm, damageOf, ease, timerFraction, timerTone, type EffectKind, type Point } from './anim';
import { playLog } from './history';
import { resetTiming, takeCasts } from './timing';
import type { CardsState } from '../shared/types';

/** at most this many effects play at once (low-spec phones) */
const MAX_EFFECTS = 8;

interface Eff {
  kind: EffectKind;
  color: number;
  from: Point;
  to: Point[];
  t0: number;
  dur: number;
  /** the player asked for less motion: nothing travels, the hit is a still line and a flash that only fade */
  still?: boolean;
}

const DURATION: Record<EffectKind, number> = { shot: 950, steal: 650, smash: 500, heal: 850, guard: 650, wave: 950, draw: 550 };

type G = Phaser.GameObjects.Graphics;

/** the same hit for people who asked for less motion: a still line to the target and a flash on it that fade in and out, nothing moves */
function drawStillHit(g: G, from: Point, to: Point, color: number, p: number): void {
  const a = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
  g.lineStyle(10, color, 0.6 * a).lineBetween(from.x, from.y, to.x, to.y);
  g.lineStyle(3, 0xffffff, 0.9 * a).lineBetween(from.x, from.y, to.x, to.y);
  g.fillStyle(0xffffff, 0.55 * a).fillCircle(to.x, to.y, 46);
  g.fillStyle(color, 0.5 * a).fillCircle(to.x, to.y, 64);
  g.lineStyle(10, color, a).strokeCircle(to.x, to.y, 76);
}

/** a big, bright comet from the caster to the target along an arc (with a faint trail of the whole path), then a shockwave on the target */
function drawShot(g: G, from: Point, to: Point, color: number, p: number, travel: number): void {
  if (p < travel) {
    const q = p / travel;
    // the path, so the eye knows where it is going
    g.lineStyle(5, color, 0.22);
    let prev = from;
    for (let k = 1; k <= 12; k++) {
      const pt = along(from, to, k / 12, 90);
      g.lineBetween(prev.x, prev.y, pt.x, pt.y);
      prev = pt;
    }
    for (let k = 9; k >= 0; k--) {
      const pt = along(from, to, ease(Math.max(0, q - k * 0.035)), 90);
      g.fillStyle(color, 0.9 - k * 0.08).fillCircle(pt.x, pt.y, 30 - k * 2.6);
    }
    const head = along(from, to, ease(q), 90);
    g.fillStyle(color, 0.28).fillCircle(head.x, head.y, 52);
    g.fillStyle(color, 0.7).fillCircle(head.x, head.y, 34);
    g.fillStyle(0xffffff, 0.95).fillCircle(head.x, head.y, 20);
  } else {
    const q = (p - travel) / (1 - travel);
    g.fillStyle(0xffffff, 0.85 * (1 - q)).fillCircle(to.x, to.y, 24 + 52 * (1 - q));
    g.fillStyle(color, 0.45 * (1 - q)).fillCircle(to.x, to.y, 40 + q * 60);
    g.lineStyle(18 * (1 - q) + 2, color, 1 - q).strokeCircle(to.x, to.y, 26 + q * 120);
    g.lineStyle(8 * (1 - q) + 1, 0xffffff, 1 - q).strokeCircle(to.x, to.y, 14 + q * 78);
    for (let k = 0; k < 10; k++) {
      const a = (k * Math.PI) / 5 + 0.2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      g.lineStyle(7 * (1 - q) + 1, k % 2 ? color : 0xffffff, 1 - q).lineBetween(to.x + dx * (30 + q * 40), to.y + dy * (30 + q * 40), to.x + dx * (52 + q * 100), to.y + dy * (52 + q * 100));
    }
  }
}

function drawEffect(g: G, e: Eff, p: number): void {
  const [t0] = e.to;
  switch (e.kind) {
    case 'shot':
      for (const t of e.to) (e.still ? drawStillHit(g, e.from, t, e.color, p) : drawShot(g, e.from, t, e.color, p, 0.64));
      break;
    case 'steal':
      if (t0) drawShot(g, t0, e.from, e.color, p, 0.64);
      break;
    case 'smash':
      if (t0) {
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3 + 0.3;
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          g.lineStyle(7 * (1 - p) + 1, e.color, 1 - p).lineBetween(t0.x + dx * (10 + p * 22), t0.y + dy * (10 + p * 22), t0.x + dx * (24 + p * 56), t0.y + dy * (24 + p * 56));
        }
        g.lineStyle(6 * (1 - p) + 1, 0xffffff, 1 - p).strokeCircle(t0.x, t0.y, 16 + p * 36);
      }
      break;
    case 'heal':
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const r = 26 + (k % 2) * 12;
        g.fillStyle(e.color, 1 - p).fillCircle(e.from.x + Math.cos(a) * r, e.from.y - p * 76 + Math.sin(a) * r * 0.4, 6 * (1 - p * 0.5));
      }
      break;
    case 'guard':
      g.fillStyle(e.color, 0.28 * (1 - p)).fillCircle(e.from.x, e.from.y, 54);
      g.lineStyle(9 * (1 - p) + 2, e.color, 1 - p).strokeCircle(e.from.x, e.from.y, 32 + ease(p) * 34);
      break;
    case 'wave': {
      // a burst round the caster, and a comet from there to every rival it hits
      if (e.still) {
        g.lineStyle(8, e.color, 0.7 * (1 - p)).strokeCircle(e.from.x, e.from.y, 60);
        for (const t of e.to) drawStillHit(g, e.from, t, e.color, p);
        break;
      }
      g.fillStyle(e.color, 0.35 * (1 - p)).fillCircle(e.from.x, e.from.y, 30 + ease(p) * 70);
      g.lineStyle(14 * (1 - p) + 2, e.color, 0.95 * (1 - p)).strokeCircle(e.from.x, e.from.y, 24 + ease(p) * 150);
      for (const t of e.to) drawShot(g, e.from, t, e.color, p, 0.64);
      break;
    }
    case 'draw':
      for (let k = 0; k < 2; k++) {
        const q = Math.min(1, Math.max(0, p * 1.5 - k * 0.3));
        const pt = along({ x: 500, y: 500 }, e.from, ease(q), k ? -45 : 45);
        g.fillStyle(0xf6efe4, 1 - q * 0.6).fillRect(pt.x - 9, pt.y - 13, 18, 26);
        g.lineStyle(2, e.color, 1 - q * 0.6).strokeRect(pt.x - 9, pt.y - 13, 18, 26);
      }
      break;
  }
}

const CENTRE: Point = { x: 500, y: 500 };
/** how long (ms) a caster keeps looking at the target of the card just cast */
const LOOK_MS = 900;
/** how fast an avatar turns (radians per second) */
const TURN_RATE = 10;

export function createBoard(ctx: ClientContext): GameRenderer {
  let effects: Eff[] = [];
  // where each avatar looks: the angle it is drawn at, a short look-at after a cast, and the last frame time
  const angles = new Map<string, number>();
  const looks = new Map<string, { angle: number; until: number }>();
  let frameAt = 0;
  return {
    reset() {
      effects = [];
      angles.clear();
      looks.clear();
      frameAt = 0;
      resetTiming();
      playLog.reset();
    },
    render(host, _a, _b, latest) {
      const s = latest as unknown as CardsState;
      const g = host.g;
      const now = performance.now();
      const dt = frameAt ? Math.min(0.1, (now - frameAt) / 1000) : 0;
      frameAt = now;
      g.fillStyle(0x1b2a41, 1).fillCircle(500, 500, 430);
      g.lineStyle(6, 0x2f4a73, 1).strokeCircle(500, 500, 430);

      const n = s.players.length;
      const seatOf = (id: string) => s.players.findIndex((p) => p.id === id);
      const posOf = (id: string): Point | null => {
        const i = seatOf(id);
        return i >= 0 ? seatPos(i, n) : null;
      };

      // the cards cast since the last frame: start their effects (the events queued them, with their sounds)
      for (const cast of takeCasts()) {
        const from = posOf(cast.p);
        const target = cast.tg ? posOf(cast.tg) : null;
        // the caster turns to the target for a moment (all-foes and untargeted cards: to the middle)
        if (from) looks.set(cast.p, { angle: angleToward(from, cast.kind !== 'wave' && target ? target : CENTRE), until: now + LOOK_MS });
        const still = calm();
        if (effects.length >= MAX_EFFECTS) continue;
        const foes = s.players.filter((p) => p.id !== cast.p && !p.out).map((p) => posOf(p.id)!);
        const to = cast.kind === 'wave' ? foes : target ? [target] : [];
        // with reduced motion only the damage shows (as a still hit); the other flights stay off
        const mainShows = !still || cast.kind === 'shot' || cast.kind === 'wave';
        if (mainShows && from && (to.length > 0 || cast.kind === 'heal' || cast.kind === 'guard' || cast.kind === 'draw')) effects.push({ kind: cast.kind, color: cast.color, from, to, t0: now, dur: DURATION[cast.kind], still });
        // a card with direct damage besides another effect (Hex steals, Shatter smashes) also sends its hit from the caster to the target
        const dmg = damageOf(cast.c);
        const hits = dmg.all ? foes : dmg.single && target ? [target] : [];
        if (from && hits.length > 0 && cast.kind !== 'shot' && cast.kind !== 'wave') effects.push({ kind: 'shot', color: cast.color, from, to: hits, t0: now, dur: DURATION.shot, still });
      }
      if (effects.length > 0) {
        effects = effects.filter((e) => now - e.t0 < e.dur);
        for (const e of effects) drawEffect(g, e, (now - e.t0) / e.dur);
      }

      s.players.forEach((p, i) => {
        const { x, y } = seatPos(i, n);
        const label = host.label(p.id);
        label.setPosition(x, y - 66);
        const hero = HEROES[p.hero % HEROES.length];
        if (p.id === s.turn) {
          g.lineStyle(8, 0xffd23f, 1).strokeCircle(x, y, 52);
          const frac = timerFraction(s.tt, s.ttMax);
          const tone = timerTone(s.tt, s.ttMax);
          // green, then amber, then a red ring that throbs in the last seconds (steady for people who asked for less motion)
          const beat = tone === 'urgent' && !calm() ? 0.5 + 0.5 * Math.sin(performance.now() / 90) : 0;
          const colour = tone === 'ok' ? 0x2fbf71 : tone === 'warn' ? 0xffb02e : 0xff3b3b;
          g.lineStyle(10 + beat * 6, colour, 1).beginPath().arc(x, y, 62 + beat * 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false).strokePath();
        }
        if (p.id === s.aim) {
          // the rival the player on turn is aiming at: a crosshair
          g.lineStyle(6, 0xff5d73, 1).strokeCircle(x, y, 46).lineBetween(x - 60, y, x - 34, y).lineBetween(x + 34, y, x + 60, y).lineBetween(x, y - 60, x, y - 34).lineBetween(x, y + 34, x, y + 60);
        }
        if (p.out) {
          g.lineStyle(10, 0x888888, 1).lineBetween(x - 30, y - 30, x + 30, y + 30).lineBetween(x + 30, y - 30, x - 30, y + 30);
          return;
        }
        // face the middle; the player on turn faces the rival aimed at (live while a card is dragged over a rival)
        const here = { x, y };
        let want = angleToward(here, CENTRE);
        const aimed = p.id === s.turn && s.aim ? posOf(s.aim) : null;
        if (aimed) want = angleToward(here, aimed);
        const look = looks.get(p.id);
        if (look && now < look.until) want = look.angle;
        const was = angles.get(p.id);
        const facing = was === undefined || calm() ? want : approach(was, want, TURN_RATE * dt);
        angles.set(p.id, facing);
        ctx.drawCharacter(g, p.id, x, y, 38, facing);
        g.fillStyle(hero.color, 1).fillRect(x - 38, y + 40, 76, 6);

        // hit points as pips
        const pip = Math.min(14, 190 / p.maxHp);
        const w = p.maxHp * pip;
        for (let k = 0; k < p.maxHp; k++) {
          g.fillStyle(k < p.hp ? 0xe5484d : 0x4a2a31, 1).fillRect(x - w / 2 + k * pip + 1, y + 54, pip - 2, 12);
        }
        // cards in hand: a fan of card backs
        const cards = Math.min(p.hand, 8);
        for (let k = 0; k < cards; k++) {
          g.fillStyle(0xf4f1e8, 1).fillRect(x + 56 + k * 9, y - 22, 14, 22);
          g.lineStyle(1, 0x233, 1).strokeRect(x + 56 + k * 9, y - 22, 14, 22);
        }
      });
    },
  };
}
