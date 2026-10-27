// A real card as DOM: hero-coloured frame, name bar, illustration window, text box with icons.
// Used by the phone hand (Controller.ts) and the shared table (Overlay.ts).
import type { ClientContext } from '../../../core/client/src/plugins/api';
import { CARDS, HEROES, heroOfCard } from '../shared/cards';
import type { Effect } from '../shared/cards';
import { artSvg } from './art';

export interface CardOpts {
  /** hand: the cards you hold; big: the last card played; table: a Defense card on the table */
  size: 'hand' | 'big' | 'table';
  selected?: boolean;
  disabled?: boolean;
  /** hit points a Defense card on the table has left (shown on its badge) */
  hp?: number;
}

const ICON = (path: string, fill: string) => `<svg class="rcc-i" viewBox="-12 -12 24 24" aria-hidden="true"><g fill="${fill}" stroke="#1b1426" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${path}</g></svg>`;
const ICONS = {
  sword: ICON('<path d="M-8,8 L6,-6 L9,-9 L9,-5 L7,-3 L-5,11 Z M-9,3 L-3,9 M-10,10 L-6,6"/>', '#ffe08a'),
  heart: ICON('<path d="M0,9 C-14,0 -10,-10 -4,-9 C-1,-8 0,-5 0,-4 C0,-5 1,-8 4,-9 C10,-10 14,0 0,9 Z"/>', '#ff5d73'),
  cards: ICON('<rect x="-9" y="-7" width="11" height="15" rx="2"/><rect x="-2" y="-9" width="11" height="15" rx="2"/>', '#f6efe4'),
  play: ICON('<path d="M-7,-8 L9,0 L-7,8 Z"/>', '#9be7ff'),
  shield: ICON('<path d="M0,-10 L9,-6 V1 Q9,9 0,12 Q-9,9 -9,1 V-6 Z"/>', '#4fc3ff'),
  steal: ICON('<path d="M-8,2 L-3,-8 L2,-3 L8,-6 L5,4 L-2,9 Z"/>', '#d8b8ff'),
  smash: ICON('<path d="M-9,-8 L-1,-1 L-6,2 L2,9 M4,-9 L1,-1 L9,4"/>', '#ffb36b'),
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

const chip = (icon: string, text: string) => `<span class="rcc-c">${icon}${text ? `<b>${text}</b>` : ''}</span>`;

function chips(f: Effect, ctx: ClientContext): string {
  switch (f.k) {
    case 'dmg': return chip(ICONS.sword, String(f.n));
    case 'all': return chip(ICONS.sword, `${f.n} ${esc(ctx.tr('All'))}`);
    case 'heal': return chip(ICONS.heart, `+${f.n}`);
    case 'draw': return chip(ICONS.cards, `+${f.n}`);
    case 'play': return chip(ICONS.play, `+${f.n}`);
    case 'steal': return chip(ICONS.steal, esc(ctx.tr('Steal')));
    case 'smash': return chip(ICONS.smash, esc(ctx.tr('Smash')));
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function cardEl(card: number, ctx: ClientContext, opts: CardOpts): HTMLElement {
  ensureStyle();
  const def = CARDS[card];
  const hero = HEROES[heroOfCard(card)];
  const el = document.createElement('div');
  el.className = `rcc ${opts.size}${opts.selected ? ' sel' : ''}${opts.disabled ? ' off' : ''}`;
  el.style.setProperty('--hero', hex(hero.color));
  const parts: string[] = [];
  if (def.def) parts.push(chip(ICONS.shield, `${def.def} ${esc(ctx.tr('Defense'))}`));
  for (const f of def.fx) parts.push(chips(f, ctx));
  const note = def.note ? `<p class="rcc-n">${esc(ctx.tr(def.note))}</p>` : '';
  const badge = opts.hp !== undefined ? `<span class="rcc-hp">${ICONS.shield}<b>${opts.hp}</b></span>` : '';
  el.innerHTML =
    `<div class="rcc-name">${esc(ctx.tr(def.name))}</div>` +
    `<div class="rcc-art">${artSvg(def.art, hero.color)}${badge}</div>` +
    `<div class="rcc-text"><div class="rcc-fx">${parts.join('')}</div>${note}</div>`;
  return el;
}

const CSS = `
.rcc{--hero:#888;position:relative;box-sizing:border-box;width:9.5em;aspect-ratio:2/3;flex:0 0 auto;display:flex;flex-direction:column;gap:.3em;padding:.4em;border-radius:.8em;
 background:linear-gradient(160deg,var(--hero),#1b1426 120%);border:.2em solid #f6efe4;box-shadow:0 .25em .7em rgba(0,0,0,.55);color:#1b1426;font:700 1em/1.15 system-ui,sans-serif;user-select:none;text-align:left}
.rcc.hand{font-size:11px}.rcc.big{font-size:15px}.rcc.table{font-size:8px}
.rcc-name{background:#f6efe4;border-radius:.45em;padding:.28em .3em;font-size:.86em;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rcc-art{position:relative;border-radius:.45em;overflow:hidden;border:.15em solid #1b1426;aspect-ratio:100/70;background:#1b1426}
.rcc-art svg{display:block;width:100%;height:100%}
.rcc-text{flex:1;min-height:0;background:#f6efe4;border-radius:.45em;padding:.3em .35em;display:flex;flex-direction:column;gap:.25em;overflow:hidden}
.rcc-fx{display:flex;flex-wrap:wrap;gap:.2em .45em;align-items:center}
.rcc-c{display:inline-flex;align-items:center;gap:.1em;font-size:.95em}
.rcc-c b{font-weight:800}
.rcc-i{width:1.5em;height:1.5em;flex:none}
.rcc-n{margin:0;font-size:.82em;font-weight:600;line-height:1.15}
.rcc-hp{position:absolute;right:.2em;bottom:.2em;display:flex;align-items:center;background:rgba(246,239,228,.92);border-radius:1em;padding:0 .35em 0 .1em;font-size:1.1em}
.rcc.table .rcc-text,.rcc.table .rcc-name{display:none}
.rcc.table{aspect-ratio:auto;align-self:flex-start;width:7.5em;padding:.3em}
.rcc.table .rcc-hp{font-size:1.15em;right:.1em;bottom:.1em;padding-right:.3em}
.rcc.sel{transform:translateY(-.9em) scale(1.07);border-color:#ffd23f;box-shadow:0 0 0 .2em #ffd23f,0 .6em 1.1em rgba(0,0,0,.6);z-index:2}
.rcc.off{filter:saturate(.35) brightness(.7)}
.rcc.deal{animation:rcc-deal .5s cubic-bezier(.2,.9,.3,1.2) backwards;animation-delay:calc(var(--d,0) * 80ms)}
@keyframes rcc-deal{from{transform:translateY(90px) scale(.6) rotate(8deg);opacity:0}}
.rcc.hand.sel{animation:rcc-float 1.5s ease-in-out infinite alternate}
@keyframes rcc-float{from{transform:translateY(-.9em) scale(1.07)}to{transform:translateY(-1.25em) scale(1.07)}}
.rcc-tag.below{top:auto;bottom:-2.6em}
.rcc-tag{position:absolute;left:50%;top:-2.6em;transform:translateX(-50%);white-space:nowrap;background:#ff5d73;color:#fff;border:.15em solid #fff;border-radius:1em;padding:.2em .9em;font:800 1.3em system-ui,sans-serif;box-shadow:0 .2em .6em rgba(0,0,0,.5)}
@media (prefers-reduced-motion: reduce){.rcc.deal,.rcc.hand.sel{animation:none}}
`;

function ensureStyle(): void {
  if (document.getElementById('rcc-style')) return;
  const s = document.createElement('style');
  s.id = 'rcc-style';
  s.textContent = CSS;
  document.head.append(s);
}
