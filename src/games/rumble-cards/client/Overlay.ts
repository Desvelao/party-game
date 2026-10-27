// The table on the shared screen (and every phone): who is who, hit point bars, Defense cards, and the last card played.
// The panels are created once and updated in place, so their bars and cards can animate.
import type { ClientContext, ControllerHandle } from '../../../core/client/src/plugins/api';
import type { GameState } from '../../../core/shared/types';
import { HEROES } from '../shared/cards';
import type { CardsPlayer, CardsState } from '../shared/types';
import { calm } from './anim';
import { cardEl } from './CardView';
import { playLog } from './history';
import { LOG_CSS, renderLog } from './HistoryView';
import { clearPanels, panelCentre, registerPanel } from './table';

const CSS = `${LOG_CSS}
.rco-log{position:absolute;left:8px;bottom:8px;width:min(34%,320px);max-height:42%;overflow:hidden;opacity:.95}
@media (max-width:640px){.rco-log{display:none}}
.rco{position:absolute;inset:0;pointer-events:none;font:700 12px system-ui,sans-serif;color:#fff}
.rco-strip{position:absolute;left:0;right:0;top:58px;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:0 6px}
.rco-p{display:flex;flex-direction:column;gap:3px;align-items:center;min-width:92px;background:rgba(12,20,36,.82);border:2px solid transparent;border-radius:10px;padding:4px 8px;transition:border-color .2s,box-shadow .2s,background .2s,opacity .4s,filter .4s}
.rco-p.turn{border-color:#ffd23f;box-shadow:0 0 12px rgba(255,210,63,.55)}
.rco-p.aim{border-color:#ff5d73;box-shadow:0 0 12px #ff5d73}
.rco-p.turn.aim{border-color:#ff5d73}
.rco-p.drop{border-color:#7dffb2;box-shadow:0 0 10px #7dffb2}
.rco-p.hot{background:rgba(47,191,113,.55);border-color:#fff;box-shadow:0 0 0 3px #7dffb2,0 0 18px #7dffb2;transform:scale(1.08)}
.rco-p.out{opacity:.45;filter:grayscale(1)}
.rco-p.hurt{animation:rco-hurt .5s}
.rco-p.heal{animation:rco-heal .6s}
.rco-p.guarded{animation:rco-guard .5s}
.rco-p.ko{animation:rco-ko .7s both}
.rco-p.discard{animation:rco-discard .6s}
.rco-p.urgent{animation:rco-urgent .5s}
.rco-p.turn.purge::after{content:'🗑';position:absolute;right:-6px;top:-8px;font-size:15px}
.rco-p{position:relative}
.rco-n{display:flex;align-items:center;gap:5px;max-width:130px;overflow:hidden;white-space:nowrap}
.rco-n i{width:10px;height:10px;border-radius:50%;flex:none}
.rco-s{font-weight:600;opacity:.85}
.rco-bar{position:relative;width:100%;height:7px;border-radius:4px;background:#3b1f27;overflow:hidden}
.rco-bar b,.rco-bar u{position:absolute;left:0;top:0;bottom:0;border-radius:4px;display:block}
.rco-bar u{background:#fff;opacity:.85;transition:width .7s ease .35s}
.rco-bar b{background:linear-gradient(#ff7a85,#e5484d);transition:width .3s ease}
.rco-d{display:flex;gap:3px;min-height:0}
.rco-d .rcc.pop{animation:rco-dpop .45s cubic-bezier(.2,.9,.3,1.3) both}
.rco-d .rcc.brk{animation:rco-brk .4s ease-in both}
.rco-last{position:absolute;left:50%;top:26%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;opacity:0}
.rco-last p{margin:0;background:rgba(12,20,36,.85);border-radius:8px;padding:3px 10px}
@keyframes rco-hurt{0%{background:rgba(229,72,77,.85)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}100%{transform:none}}
@keyframes rco-heal{0%{background:rgba(47,191,113,.8);transform:scale(1.1)}100%{transform:none}}
@keyframes rco-guard{0%{background:rgba(79,195,255,.8);transform:scale(1.08)}100%{transform:none}}
@keyframes rco-discard{0%{background:rgba(255,179,107,.85);transform:translateY(-3px)}100%{transform:none}}
@keyframes rco-urgent{0%{background:rgba(229,72,77,.7);transform:scale(1.07)}100%{transform:none}}
@keyframes rco-ko{0%{transform:translateX(-6px)}15%{transform:translateX(6px)}30%{transform:translateX(-5px) rotate(-2deg)}60%{transform:translateY(6px) rotate(3deg)}100%{transform:translateY(2px)}}
@keyframes rco-dpop{0%{transform:scale(.2) rotate(-12deg);opacity:0}100%{transform:none;opacity:1}}
@keyframes rco-brk{0%{transform:none;opacity:1;filter:brightness(1)}40%{transform:scale(1.35) rotate(6deg);filter:brightness(2)}100%{transform:scale(.4) rotate(-20deg);opacity:0}}
@media (prefers-reduced-motion: reduce){.rco-p.hurt,.rco-p.heal,.rco-p.guarded,.rco-p.ko,.rco-p.discard,.rco-p.urgent,.rco-d .rcc.pop,.rco-d .rcc.brk{animation-duration:.01s}}
`;

interface DefEl {
  card: number;
  hp: number;
  el: HTMLElement;
}
interface Panel {
  box: HTMLElement;
  stat: HTMLElement;
  fill: HTMLElement;
  lag: HTMLElement;
  defs: HTMLElement;
  shown: DefEl[];
  out: boolean;
}

export function createOverlay(el: HTMLElement, ctx: ClientContext): ControllerHandle {
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'rco';
  const strip = document.createElement('div');
  strip.className = 'rco-strip';
  const last = document.createElement('div');
  last.className = 'rco-last';
  const log = document.createElement('div');
  log.className = 'rco-log';
  root.append(strip, last, log);
  el.append(style, root);
  /** the history on the table: the last plays, the newest on top, the one that just came in sliding down */
  let seenLog = 0;
  const drawLog = () => {
    const list = playLog.entries();
    renderLog(log, list, ctx, 6, seenLog + 1);
    seenLog = list.length ? list[list.length - 1].n : 0;
  };
  drawLog();
  const unsub = playLog.subscribe(drawLog);

  const panels = new Map<string, Panel>();
  let lastN = 0;
  let flight: Animation | null = null;
  const hexOf = (c: number) => '#' + c.toString(16).padStart(6, '0');

  const makePanel = (p: CardsPlayer): Panel => {
    const box = document.createElement('div');
    box.className = 'rco-p';
    const name = document.createElement('div');
    name.className = 'rco-n';
    const dot = document.createElement('i');
    dot.style.background = hexOf(ctx.colorOf(p.id));
    const label = document.createElement('span');
    label.textContent = ctx.labelOf(p.id);
    name.append(dot, label);
    const stat = document.createElement('div');
    stat.className = 'rco-s';
    const bar = document.createElement('div');
    bar.className = 'rco-bar';
    const lag = document.createElement('u');
    const fill = document.createElement('b');
    bar.append(lag, fill);
    const defs = document.createElement('div');
    defs.className = 'rco-d';
    box.append(name, stat, bar, defs);
    strip.append(box);
    registerPanel(p.id, box);
    return { box, stat, fill, lag, defs, shown: [], out: false };
  };

  /** keep the Defense cards in step: new ones pop in, destroyed ones break, the rest only update their hit points */
  const syncDefs = (pn: Panel, def: [number, number][]) => {
    const prev = pn.shown.slice();
    const next: DefEl[] = [];
    for (const [card, hp] of def) {
      const i = prev.findIndex((d) => d.card === card);
      if (i >= 0) {
        const [d] = prev.splice(i, 1);
        if (d.hp !== hp) {
          const b = d.el.querySelector('.rcc-hp b');
          if (b) b.textContent = String(hp);
          d.hp = hp;
        }
        next.push(d);
      } else {
        const node = cardEl(card, ctx, { size: 'table', hp });
        node.classList.add('pop');
        next.push({ card, hp, el: node });
      }
    }
    for (const gone of prev) {
      gone.el.classList.add('brk');
      setTimeout(() => gone.el.remove(), calm() ? 50 : 420);
    }
    // keep the table order; broken cards are already out of `next` and fade where they were
    for (const d of next) pn.defs.append(d.el);
    pn.shown = next;
  };

  const syncStrip = (s: CardsState) => {
    if (panels.size !== s.players.length || s.players.some((p) => !panels.has(p.id))) {
      strip.textContent = '';
      panels.clear();
      clearPanels();
      for (const p of s.players) panels.set(p.id, makePanel(p));
    }
    for (const p of s.players) {
      const pn = panels.get(p.id)!;
      pn.box.classList.toggle('turn', p.id === s.turn);
      pn.box.classList.toggle('purge', p.id === s.turn && s.purge > 0);
      pn.box.classList.toggle('aim', p.id === s.aim);
      pn.box.classList.toggle('out', p.out);
      if (p.out && !pn.out) pn.box.classList.add('ko');
      pn.out = p.out;
      pn.stat.textContent = p.out ? ctx.tr('Eliminated') : `${ctx.tr(HEROES[p.hero % HEROES.length].name)}  ♥ ${p.hp}/${p.maxHp}`;
      const pct = `${Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100))}%`;
      pn.fill.style.width = pct;
      pn.lag.style.width = pct;
      syncDefs(pn, p.def);
    }
  };

  /** the last card played flies from who played it to the middle, waits, then flies at its target */
  const showLast = (s: CardsState) => {
    const l = s.last;
    if (!l || l.n === lastN) return;
    lastN = l.n;
    flight?.cancel();
    last.textContent = '';
    last.append(cardEl(l.c, ctx, { size: 'big' }));
    const who = document.createElement('p');
    who.textContent = l.tg ? `${ctx.labelOf(l.p)} ➜ ${ctx.labelOf(l.tg)}` : ctx.labelOf(l.p);
    last.append(who);
    const r = last.getBoundingClientRect();
    const mid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const from = panels.has(l.p) ? panelCentre(l.p) : mid;
    const to = l.tg && panels.has(l.tg) ? panelCentre(l.tg) : null;
    const at = (c: { x: number; y: number }, scale: number, rot: number, opacity: number): Keyframe => ({
      transform: `translate(calc(-50% + ${c.x - mid.x}px), ${c.y - mid.y}px) scale(${scale}) rotate(${rot}deg)`,
      opacity,
    });
    const home: Keyframe = { transform: 'translate(-50%,0) scale(1) rotate(0deg)', opacity: 1 };
    const frames: Keyframe[] = calm()
      ? [{ ...home, opacity: 0 }, { ...home, offset: 0.1 }, { ...home, offset: 0.8 }, { ...home, opacity: 0 }]
      : [
          { ...at(from, 0.25, -14, 0), offset: 0 },
          { ...home, offset: 0.2, easing: 'ease-out' },
          { ...home, offset: 0.66 },
          to ? { ...at(to, 0.3, 16, 0), offset: 1, easing: 'ease-in' } : { transform: 'translate(-50%,-34px) scale(1.18) rotate(0deg)', opacity: 0, offset: 1 },
        ];
    flight = last.animate(frames, { duration: 2400, fill: 'forwards' });
  };

  return {
    update(state: GameState | null) {
      const s = state as CardsState | null;
      if (!s) return;
      syncStrip(s);
      showLast(s);
    },
    destroy() {
      unsub();
      flight?.cancel();
      clearPanels();
      root.remove();
      style.remove();
    },
  };
}
