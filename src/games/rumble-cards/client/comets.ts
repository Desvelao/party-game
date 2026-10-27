// The damage comet for players: a glowing ball that flies from the caster's panel to the panel of each rival the card
// hits, over the players strip (a player's screen shows no table, so the canvas comet of Board.ts is not there).
// Only a player's controls register the sink, so the table does not get a second comet.
import { calm, cometPath, type Point } from './anim';
import { panelCentre, panelIds } from './table';

export interface CometCast {
  /** the card's direct damage reaches the aimed rival (`single`), every rival (`all`), or both */
  single: boolean;
  all: boolean;
  /** who played it and whom they aimed at ('' for none) */
  p: string;
  tg: string;
  color: number;
}

type Sink = (cast: CometCast) => void;
let sink: Sink | null = null;

/** the controls of a player register to draw comets; null when they go away */
export function setCometSink(fn: Sink | null): void {
  sink = fn;
}

export function fireComets(cast: CometCast): void {
  sink?.(cast);
}

/** the rivals a cast reaches: everyone still in except the caster for a hit-everyone card, else the aimed one (or the only rival) */
export function targetsOf(cast: Pick<CometCast, 'single' | 'all' | 'p' | 'tg'>, players: { id: string; out: boolean }[]): string[] {
  const foes = players.filter((x) => x.id !== cast.p && !x.out).map((x) => x.id);
  if (cast.all) return foes;
  if (!cast.single) return [];
  if (cast.tg && foes.includes(cast.tg)) return [cast.tg];
  return foes.length === 1 ? foes : [];
}

/** at most this many comets at once (low-spec phones) */
const MAX_COMETS = 12;
const FLIGHT_MS = 600;
let live = 0;

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

function put(host: HTMLElement, css: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:0;top:0;z-index:8;pointer-events:none;border-radius:50%;${css}`;
  host.append(el);
  return el;
}

/** the ring and flash where the comet lands (also the whole effect when the player asked for less motion) */
function impact(host: HTMLElement, at: Point, color: string, delay: number): void {
  const flash = put(host, `width:70px;height:70px;margin:-35px 0 0 -35px;background:radial-gradient(#fff,${color} 60%,transparent 72%);opacity:0`);
  const ring = put(host, `width:70px;height:70px;margin:-35px 0 0 -35px;border:6px solid ${color};box-sizing:border-box;opacity:0`);
  const at0 = `translate(${at.x}px,${at.y}px)`;
  const a = flash.animate([{ transform: `${at0} scale(.4)`, opacity: 0 }, { transform: `${at0} scale(1.5)`, opacity: 1, offset: 0.3 }, { transform: `${at0} scale(1.9)`, opacity: 0 }], { duration: 420, delay, fill: 'both' });
  const b = ring.animate([{ transform: `${at0} scale(.5)`, opacity: 0.95 }, { transform: `${at0} scale(2.6)`, opacity: 0 }], { duration: 520, delay, fill: 'both' });
  a.onfinish = () => flash.remove();
  b.onfinish = () => ring.remove();
}

/** Fly a comet from one panel to another (a still line and a flash that only fade for reduced motion). */
export function flyComet(from: string, to: string, color: number): void {
  if (typeof document === 'undefined' || live >= MAX_COMETS) return;
  const host = document.getElementById('overlay') ?? document.body;
  const a = panelCentre(from);
  const b = panelCentre(to);
  const css = hex(color);
  live++;
  const done = () => {
    live--;
  };
  if (calm()) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const line = put(host, `left:${a.x}px;top:${a.y}px;width:${len}px;height:8px;margin-top:-4px;border-radius:4px;background:${css};transform-origin:0 50%;transform:rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad);opacity:0`);
    const fade = line.animate([{ opacity: 0 }, { opacity: 0.8, offset: 0.3 }, { opacity: 0 }], { duration: 800 });
    fade.onfinish = () => {
      line.remove();
      done();
    };
    impact(host, b, css, 0);
    return;
  }
  const path = cometPath(a, b, 14);
  // the head and a trail of smaller, fainter balls that follow the same arc a little later
  const sizes = [34, 28, 23, 18, 14, 10];
  let ended = 0;
  sizes.forEach((size, k) => {
    const el = put(host, `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;background:${k === 0 ? `radial-gradient(#fff 28%,${css} 62%)` : css};box-shadow:0 0 ${k === 0 ? 22 : 10}px ${k === 0 ? 8 : 2}px ${css};opacity:0`);
    const anim = el.animate(
      path.map((pt, i) => ({ transform: `translate(${pt.x}px,${pt.y}px)`, opacity: i === 0 ? 0 : i === path.length - 1 ? 0 : 1 - k * 0.14, offset: i / (path.length - 1) })),
      { duration: FLIGHT_MS, delay: k * 38, fill: 'both', easing: 'linear' },
    );
    anim.onfinish = () => {
      el.remove();
      if (++ended === sizes.length) done();
    };
  });
  impact(host, b, css, FLIGHT_MS - 40);
}

/** the sink of a player's controls: a comet to every rival the card hits */
export function drawComets(cast: CometCast): void {
  for (const to of targetsOf(cast, panelIds())) flyComet(cast.p, to, cast.color);
}
