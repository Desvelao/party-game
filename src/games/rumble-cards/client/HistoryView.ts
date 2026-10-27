// Draws the history (see history.ts) as DOM: the same list on the table and on the phones.
import type { ClientContext } from '../../../core/client/src/plugins/api';
import { CARDS } from '../shared/cards';
import type { Change, Entry } from './history';

export const LOG_CSS = `
.rch{display:flex;flex-direction:column;gap:5px;font:600 12px/1.25 system-ui,sans-serif;color:#fff}
.rch .e{background:rgba(12,20,36,.82);border-left:4px solid #ffd23f;border-radius:6px;padding:4px 8px}
.rch .e.discard{border-left-color:#ffb36b;opacity:.85}
.rch .e.fresh{animation:rch-in .5s ease-out}
.rch .h{display:flex;flex-wrap:wrap;gap:4px;align-items:baseline}
.rch .h b{font-weight:800}
.rch .card{color:#ffe08a}
.rch .c{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin-top:2px;opacity:.95}
.rch .c .who{opacity:.8}
.rch .lose{color:#ff7a85}
.rch .gain{color:#6dff9f}
.rch .shl{color:#7fd4ff}
.rch .now{opacity:.7;font-weight:500}
.rch .none{opacity:.7;padding:4px 8px;font-weight:500}
@keyframes rch-in{0%{opacity:0;transform:translateY(-8px)}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.rch .e.fresh{animation:none}}
`;

const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

const span = (cls: string, text: string): HTMLElement => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
};

/** the changes of one player as small coloured chips: -2 ♥  -1 🛡  (7♥ 1🛡) */
function changeEl(id: string, ch: Change, ctx: ClientContext): HTMLElement {
  const row = document.createElement('div');
  row.className = 'c';
  row.append(span('who', ctx.labelOf(id)));
  if (ch.hp !== 0) row.append(span(ch.hp < 0 ? 'lose' : 'gain', `${sign(ch.hp)} ♥`));
  if (ch.sh !== 0) row.append(span(ch.sh < 0 ? 'shl' : 'gain', `${sign(ch.sh)} 🛡`));
  if (ch.broke > 0) row.append(span('shl', `💥${ch.broke > 1 ? ` ×${ch.broke}` : ''}`));
  if (ch.hpNow !== undefined) row.append(span('now', `(${ch.hpNow}♥${ch.shNow ? ` ${ch.shNow}🛡` : ''})`));
  if (ch.out) row.append(span('lose', `☠ ${ctx.tr('Eliminated')}`));
  return row;
}

export function entryEl(e: Entry, ctx: ClientContext, fresh = false): HTMLElement {
  const box = document.createElement('div');
  box.className = `e ${e.kind}${fresh ? ' fresh' : ''}`;
  const head = document.createElement('div');
  head.className = 'h';
  const who = document.createElement('b');
  who.textContent = ctx.labelOf(e.p);
  head.append(who);
  if (e.kind === 'discard') {
    head.append(span('', `${ctx.tr('discarded')}${e.auto ? ' 🎲' : ''}`), span('card', ctx.tr(CARDS[e.c].name)));
    box.append(head);
    return box;
  }
  head.append(span('card', ctx.tr(CARDS[e.c].name)));
  if (e.tg) head.append(span('', `➜ ${ctx.labelOf(e.tg)}`));
  box.append(head);
  for (const [id, ch] of Object.entries(e.changes)) box.append(changeEl(id, ch, ctx));
  return box;
}

/** fill `host` with the last `max` entries, newest first */
export function renderLog(host: HTMLElement, entries: readonly Entry[], ctx: ClientContext, max: number, freshFrom = Infinity): void {
  host.textContent = '';
  host.classList.add('rch');
  if (entries.length === 0) {
    host.append(span('none', ctx.tr('No cards played yet')));
    return;
  }
  for (let i = entries.length - 1; i >= Math.max(0, entries.length - max); i--) host.append(entryEl(entries[i], ctx, entries[i].n >= freshFrom));
}
