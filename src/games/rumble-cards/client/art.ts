// Card illustrations, drawn from code as inline SVG (packs ship no image files). Each motif is drawn around
// (0, 0) in roughly a 48x48 box; `artSvg` places 1 to 3 of them on a 100x70 window tinted with the hero's colour.
import type { CardDef, Motif } from '../shared/cards';

const INK = '#1b1426';
const st = `stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

export const MOTIFS: Record<Motif, string> = {
  bolt: `<polygon points="5,-24 -13,4 -2,4 -7,24 14,-7 3,-7" fill="#ffd23f" ${st}/>`,
  paw: `<ellipse cx="0" cy="8" rx="12" ry="10" fill="#f6efe4" ${st}/>` +
    [[-14, -6], [-5, -15], [5, -15], [14, -6]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="6.5" fill="#f6efe4" ${st}/>`).join(''),
  rock: `<polygon points="-18,8 -11,-13 6,-18 19,-3 15,15 -6,18" fill="#9a8f86" ${st}/><polyline points="-6,-8 2,0 -3,10" fill="none" stroke="#6b625b" stroke-width="2.4" stroke-linecap="round"/>`,
  wall: [-16, 0, 16].map((y, r) => [0, 1, 2].map((c) => {
    const x = -24 + c * 17 + (r % 2 ? 8 : 0);
    return `<rect x="${x}" y="${y - 7}" width="16" height="14" rx="2" fill="${r % 2 ? '#b7774f' : '#cf8a5e'}" ${st}/>`;
  }).join('')).join(''),
  shield: `<path d="M0,-24 L19,-16 V2 Q19,19 0,26 Q-19,19 -19,2 V-16 Z" fill="#4fc3ff" ${st}/><path d="M0,-15 V19 M-11,-4 H11" stroke="#e8f7ff" stroke-width="3.4" stroke-linecap="round" fill="none"/>`,
  heart: `<path d="M0,20 C-26,2 -20,-20 -8,-17 C-3,-16 0,-11 0,-9 C0,-11 3,-16 8,-17 C20,-20 26,2 0,20 Z" fill="#ff5d73" ${st}/><path d="M-12,-9 Q-8,-14 -4,-12" stroke="#ffd0d6" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  swirl: `<path d="M0,0 a4,4 0 0 1 8,0 a9,9 0 0 1 -18,0 a14,14 0 0 1 28,0 a19,19 0 0 1 -38,0" fill="none" stroke="#9be7ff" stroke-width="5" stroke-linecap="round"/><path d="M0,0 a4,4 0 0 1 8,0 a9,9 0 0 1 -18,0 a14,14 0 0 1 28,0 a19,19 0 0 1 -38,0" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`,
  feather: `<path d="M-14,20 C-26,-6 -4,-24 18,-22 C20,0 6,18 -14,20 Z" fill="#d8b8ff" ${st}/><path d="M-14,20 L12,-14" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M-6,10 L2,12 M-2,2 L8,4 M2,-6 L12,-4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
  eye: `<path d="M-24,0 Q0,-24 24,0 Q0,24 -24,0 Z" fill="#fffbe8" ${st}/><circle cx="0" cy="0" r="9" fill="#b36bff" ${st}/><circle cx="0" cy="0" r="3.6" fill="${INK}"/><circle cx="-3" cy="-3" r="1.8" fill="#fff"/>`,
  moon: `<path d="M8,-22 A22,22 0 1 0 8,22 A16,16 0 1 1 8,-22 Z" fill="#fff1a8" ${st}/>`,
  comet: `<polygon points="-26,-14 6,-4 -2,6" fill="#8fe1ff" opacity="0.85"/><polygon points="-30,2 4,2 -10,12" fill="#4fc3ff" opacity="0.7"/><circle cx="12" cy="2" r="12" fill="#ffd8a8" ${st}/><circle cx="8" cy="-2" r="4" fill="#fff6e6"/>`,
  stars: `<polygon points="0,-22 5,-6 22,-4 8,5 13,22 0,12 -13,22 -8,5 -22,-4 -5,-6" fill="#fff1a8" ${st}/>`,
};

/** where the 1 to 3 copies of a motif sit on the 100x70 window: [x, y, scale] */
const SLOTS: Record<number, [number, number, number][]> = {
  1: [[50, 36, 1.05]],
  2: [[33, 40, 0.8], [67, 33, 0.8]],
  3: [[24, 42, 0.62], [50, 31, 0.78], [76, 42, 0.62]],
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
let uid = 0;

/** The SVG of a card's illustration window, on a gradient in the hero's colour. */
export function artSvg(art: CardDef['art'], heroColor: number): string {
  const id = `rcg${uid++}`;
  const tint = hex(heroColor);
  const slots = SLOTS[Math.min(3, Math.max(1, art.n ?? 1))];
  const body = slots.map(([x, y, k]) => `<g transform="translate(${x} ${y}) scale(${k})">${MOTIFS[art.m]}</g>`).join('');
  return `<svg viewBox="0 0 100 70" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<defs><radialGradient id="${id}" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${tint}" stop-opacity="0.95"/><stop offset="1" stop-color="#1b1426"/></radialGradient></defs>` +
    `<rect width="100" height="70" fill="url(#${id})"/>` +
    `<circle cx="50" cy="35" r="30" fill="#fff" opacity="0.10"/>${body}</svg>`;
}
