// The phone controls: your hand of real cards. Tap to select (tap again to play), drag a card onto the table or a
// rival to throw it, or use the cross (pick card / rival) and the action buttons (Play / End turn) of the core controls.
import type { ClientContext, ControllerHandle } from '../../../core/client/src/plugins/api';
import type { GameState } from '../../../core/shared/types';
import { HEROES, needsTarget } from '../shared/cards';
import type { CardsPrivate, CardsState } from '../shared/types';
import { cardEl } from './CardView';
import { calm, newCards, timerTone } from './anim';
import { drawComets, setCometSink } from './comets';
import { playLog } from './history';
import { LOG_CSS, renderLog } from './HistoryView';
import { UI } from './sounds';
import { clampToScreen, dragMode, tilt, type DragMode } from './drag';
import { markDrop, panelAt, panelCentre } from './table';

const STYLE = `${LOG_CSS}
.rc .log{max-height:34vh;overflow-y:auto;padding:2px}
.rc .bar .tools{display:flex;gap:6px}
.rc .rc-count{opacity:.7;font-weight:500}
.rc{display:flex;flex-direction:column;gap:6px;color:#fff;font:600 14px system-ui,sans-serif}
.rc .bar{display:flex;justify-content:space-between;align-items:center;gap:8px;background:rgba(12,20,36,.88);border-radius:12px;padding:6px 8px 6px 12px}
.rc .row{display:flex;flex-wrap:wrap;gap:6px}
.rc button{font:inherit;color:#fff;border:2px solid rgba(255,255,255,.3);border-radius:12px;background:rgba(30,45,75,.92);padding:6px 10px;min-height:40px}
.rc button:disabled{opacity:.45}
.rc .foe.sel{border-color:#ff5d73;background:rgba(110,30,45,.95)}
.rc .hand{display:flex;gap:8px;overflow-x:auto;padding:16px 6px 8px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.rc .hand .rcc{scroll-snap-align:center;cursor:grab;touch-action:pan-x;user-select:none;-webkit-user-select:none}
.rc .hand .rcc.press{transform:scale(1.04)}
.rc .hand .rcc.lifted{visibility:hidden}
.rcc.drag{position:fixed;margin:0;z-index:60;pointer-events:none;will-change:transform;cursor:grabbing;transform:scale(1.08);box-shadow:0 1em 2em rgba(0,0,0,.6)}
.rcc.fly{transition:transform .28s ease-in,opacity .28s ease-in}
.rc .end.pulse{animation:rc-pulse 1.3s ease-in-out infinite}
@keyframes rc-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,210,63,0)}50%{box-shadow:0 0 0 5px rgba(255,210,63,.55)}}
@keyframes rc-blink{50%{opacity:.35}}
.rc .tt-warn{color:#ffb02e}
.rc .tt-urgent{color:#ff6b6b;animation:rc-blink .5s steps(2) infinite}
.rc .purge{background:rgba(255,179,107,.18);border:2px dashed #ffb36b;border-radius:12px;padding:6px 10px;text-align:center}
@media (prefers-reduced-motion: reduce){.rc .end.pulse{animation:none}.rc .tt-urgent{animation:none}}
`;

export function createController(el: HTMLElement, ctx: ClientContext): ControllerHandle {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const root = document.createElement('div');
  root.className = 'rc';
  el.append(style, root);

  let pub: CardsState | null = null;
  let priv: CardsPrivate | null = null;
  let selected = -1;
  /** the selection the server last reported; a change of it (the cross moved) overrides what was tapped */
  let seenCur = -1;
  /** the hand drawn last, to animate the cards that are new; and whose turn it was, to announce ours */
  let prevHand: number[] = [];
  let prevTurn = '';
  let sig = '';
  let timerEl: HTMLElement | null = null;
  let dragging = false;
  /** the history panel is open (it stays so while the hand redraws) */
  let showLog = false;
  let logBtnEl: HTMLButtonElement | null = null;
  const logLabel = () => `${ctx.tr('History')}${playLog.entries().length ? ` (${playLog.entries().length})` : ''}`;
  let dirty = false;
  let cleanup: (() => void) | null = null;

  const me = () => pub?.players.find((p) => p.id === ctx.myId());
  const foes = () => (pub?.players ?? []).filter((p) => p.id !== ctx.myId() && !p.out);
  const myTurn = () => !!pub && pub.turn === ctx.myId();
  const hand = () => priv?.hand ?? [];
  /** your turn is over but the hand is above the limit: pick the cards to throw away */
  const purging = () => myTurn() && (pub?.purge ?? 0) > 0;
  const aimsAtChoice = (card: number) => needsTarget(card) && foes().length > 1;
  /** the rival a card will hit when thrown or played without choosing: the aimed one, else the first */
  const defaultTarget = () => (pub && foes().some((f) => f.id === pub!.aim) ? pub.aim : foes()[0]?.id);

  const play = (i: number, target?: string) => {
    if (!myTurn() || i < 0 || i >= hand().length) return;
    const card = hand()[i];
    const tg = needsTarget(card) ? target ?? defaultTarget() : undefined;
    ctx.send(tg && foes().length > 1 ? { a: 'play', c: i, tg } : { a: 'play', c: i });
  };

  const discard = (i: number) => {
    if (!purging() || i < 0 || i >= hand().length) return;
    ctx.send({ a: 'discard', c: i });
  };

  const select = (i: number) => {
    selected = i;
    ctx.sound(UI.pick);
    ctx.send({ a: 'sel', c: i });
  };

  const btn = (cls: string, text: string, onTap: () => void, disabled = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.disabled = disabled;
    b.addEventListener('click', onTap);
    return b;
  };

  // ---- dragging a card: it follows the pointer; drop it on a rival's panel to target, or on the table to throw ----

  /** Lift a card out of the hand: a copy at exactly the same place that then moves with the pointer. */
  const liftCard = (src: HTMLElement, i: number, handRow: HTMLElement) => {
    const card = hand()[i];
    const choose = aimsAtChoice(card);
    const box = src.getBoundingClientRect();
    const origin = { left: box.left, top: box.top, width: box.width, height: box.height };
    const ghost = cardEl(card, ctx, { size: 'hand' });
    ghost.classList.add('drag');
    // the rival this card will hit if let go now; it changes as the finger passes over a panel
    const origAim = pub?.aim ?? '';
    const base = foes().some((f) => f.id === origAim) ? origAim : foes()[0]?.id ?? '';
    let aimSent = base;
    let hover: string | undefined;
    const tag = needsTarget(card) ? document.createElement('div') : null;
    if (tag) {
      tag.className = 'rcc-tag';
      tag.textContent = `➜ ${ctx.labelOf(base)}`;
      ghost.append(tag);
    }
    const aimAt = (id: string) => {
      ctx.sound(UI.aim);
      if (tag) tag.textContent = `➜ ${ctx.labelOf(id)}`;
      if (choose && id !== aimSent) {
        aimSent = id; // everyone's crosshair follows the finger
        ctx.send({ a: 'aim', tg: id });
      }
    };
    ghost.style.left = `${origin.left}px`;
    ghost.style.top = `${origin.top}px`;
    document.body.append(ghost);
    src.classList.add('lifted');
    if (choose) markDrop(foes().map((f) => f.id));
    ctx.sound(UI.pick);
    let pending: { dx: number; dy: number; x: number; y: number } | null = null;
    let frame = 0;
    let at = { dx: 0, dy: 0 };

    const paint = () => {
      frame = 0;
      if (!pending) return;
      const c = clampToScreen(origin, pending.dx, pending.dy, window.innerWidth, window.innerHeight);
      at = c;
      ghost.style.transform = `translate(${c.dx}px,${c.dy}px) rotate(${tilt(pending.dx)}deg) scale(1.08)`;
      tag?.classList.toggle('below', origin.top + c.dy < 70); // near the top of the screen the tag goes under the card
      const over = panelAt(pending.x, pending.y);
      const rival = over && foes().some((f) => f.id === over) ? over : undefined;
      if (choose) markDrop(foes().map((f) => f.id), rival ?? null);
      if (rival !== hover) {
        hover = rival;
        aimAt(rival ?? base);
      }
    };
    const finishAnimation = () => {
      ghost.remove();
      src.classList.remove('lifted');
    };
    return {
      /** the pointer moved to (x, y); the card keeps the offset it was grabbed with */
      move(x: number, y: number, startX: number, startY: number) {
        pending = { dx: x - startX, dy: y - startY, x, y };
        if (!frame) frame = requestAnimationFrame(paint);
      },
      drop(x: number, y: number, ok: boolean) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        markDrop(null);
        const handTop = handRow.getBoundingClientRect().top;
        const over = panelAt(x, y);
        const rival = over && foes().some((f) => f.id === over) ? over : undefined;
        // a rival's panel targets them; the table (above the hand) throws at the aimed rival; the hand cancels
        const thrown = ok && myTurn() && (rival !== undefined || y < handTop - 24);
        ghost.classList.add('fly');
        // a cancelled drag puts the aim back where it was
        if (!thrown && aimSent !== base) ctx.send({ a: 'aim', tg: base });
        if (thrown && rival && tag) tag.textContent = `➜ ${ctx.labelOf(rival)}`;
        if (thrown) {
          play(i, rival);
          const to = rival ? panelCentre(rival) : { x: origin.left + origin.width / 2 + at.dx, y: origin.top + at.dy - 140 };
          const dx = to.x - (origin.left + origin.width / 2);
          const dy = to.y - (origin.top + origin.height / 2);
          ghost.style.transform = `translate(${dx}px,${dy}px) rotate(10deg) scale(.45)`;
          ghost.style.opacity = '0';
        } else {
          ghost.style.transform = 'translate(0,0) rotate(0deg) scale(1)';
        }
        setTimeout(finishAnimation, 300);
      },
      abort() {
        if (frame) cancelAnimationFrame(frame);
        markDrop(null);
        finishAnimation();
      },
    };
  };

  /** a played-by-tap card lifts off and fades before the hand redraws */
  const flyAway = (src: HTMLElement, card: number) => {
    if (calm()) return;
    const r = src.getBoundingClientRect();
    const ghost = cardEl(card, ctx, { size: 'hand' });
    ghost.classList.add('drag');
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    document.body.append(ghost);
    src.classList.add('lifted');
    const a = ghost.animate(
      [{ transform: 'translateY(0) scale(1.08)', opacity: 1 }, { transform: 'translateY(-150px) scale(.5) rotate(8deg)', opacity: 0 }],
      { duration: 320, easing: 'ease-in' },
    );
    a.onfinish = () => ghost.remove();
  };

  const bindCard = (node: HTMLElement, i: number, handRow: HTMLElement) => {
    // on your turn the card owns the gesture (no browser scrolling or cancelling); otherwise the hand scrolls natively
    node.style.touchAction = myTurn() ? 'none' : 'pan-x';
    node.addEventListener('pointerdown', (e) => {
      if (!myTurn() || dragging || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const id = e.pointerId;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const scroll0 = handRow.scrollLeft;
      let mode: DragMode = 'undecided';
      let lift: ReturnType<typeof liftCard> | null = null;
      dragging = true;
      try {
        node.setPointerCapture(id);
      } catch {
        /* the pointer is already gone */
      }
      node.classList.add('press');
      handRow.style.scrollSnapType = 'none'; // the snap would fight a scroll we set ourselves

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        const dx = ev.clientX - x0;
        const dy = ev.clientY - y0;
        if (mode === 'undecided') {
          mode = dragMode(dx, dy);
          if (mode === 'drag' && purging()) mode = 'scroll'; // cards cannot be thrown at anyone now, only discarded
          if (mode === 'drag') {
            lift = liftCard(node, i, handRow);
            cleanup = () => lift?.abort();
          }
        }
        if (mode === 'scroll') handRow.scrollLeft = scroll0 - dx;
        else if (mode === 'drag') lift?.move(ev.clientX, ev.clientY, x0, y0);
      };
      const end = (ev: PointerEvent, ok: boolean) => {
        if (ev.pointerId !== id) return;
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', cancel);
        try {
          node.releasePointerCapture(id);
        } catch {
          /* already released */
        }
        node.classList.remove('press');
        handRow.style.scrollSnapType = '';
        cleanup = null;
        if (mode === 'drag') {
          lift?.drop(ev.clientX, ev.clientY, ok);
          // the hand is rebuilt only after the card's flight, so nothing jumps under it
          setTimeout(() => {
            dragging = false;
            if (dirty) {
              dirty = false;
              render();
            }
          }, 320);
          return;
        }
        dragging = false;
        if (mode === 'undecided' && ok) {
          // a tap: select, and a second tap plays
          if (selected === i) {
            flyAway(node, hand()[i]);
            if (purging()) discard(i);
            else play(i);
          } else select(i);
          dirty = true;
        }
        if (dirty) {
          dirty = false;
          render();
        }
      };
      const up = (ev: PointerEvent) => end(ev, true);
      const cancel = (ev: PointerEvent) => end(ev, false);
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', cancel);
    });
  };

  // ---- drawing ---------------------------------------------------------------------------------------

  function render(): void {
    if (dragging) {
      dirty = true;
      return;
    }
    const keepScroll = root.querySelector<HTMLElement>('.hand')?.scrollLeft ?? 0;
    root.textContent = '';
    const m = me();
    if (!pub || !m) return;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const info = document.createElement('div');
    const hero = document.createElement('div');
    hero.textContent = `${ctx.tr(HEROES[m.hero % HEROES.length].name)}  ♥ ${m.hp}/${m.maxHp}`;
    timerEl = document.createElement('div');
    info.append(hero, timerEl);
    const endBtn = purging()
      ? btn('end', ctx.tr('Discard'), () => discard(selected), selected < 0 || selected >= hand().length)
      : btn('end', ctx.tr('End turn'), () => ctx.send({ a: 'end' }), !myTurn() || pub.made < 1);
    if (myTurn() && (purging() || pub.made >= 1)) endBtn.classList.add('pulse'); // you may stop now
    const logBtn = btn('hist', logLabel(), () => {
      showLog = !showLog;
      render();
    });
    logBtn.classList.toggle('sel', showLog);
    logBtnEl = logBtn;
    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.append(logBtn, endBtn);
    bar.append(info, tools);
    root.append(bar);
    if (showLog) {
      const box = document.createElement('div');
      box.className = 'log';
      renderLog(box, playLog.entries(), ctx, 12);
      root.append(box);
    }
    if (purging()) {
      const note = document.createElement('div');
      note.className = 'purge';
      note.textContent = `${ctx.tr('Discard the extra cards')}: ${pub.purge}`;
      root.append(note);
    }

    const chosen = hand()[selected];
    if (myTurn() && !purging() && chosen !== undefined && aimsAtChoice(chosen)) {
      // tapping a rival plays the selected card on them
      const row = document.createElement('div');
      row.className = 'row';
      for (const f of foes()) {
        row.append(btn(`foe${f.id === pub.aim ? ' sel' : ''}`, `${ctx.labelOf(f.id)}  ♥${f.hp}`, () => play(selected, f.id)));
      }
      root.append(row);
    }

    const cards = document.createElement('div');
    cards.className = 'hand';
    const fresh = newCards(prevHand, hand());
    let dealt = 0;
    if (fresh.some(Boolean)) ctx.sound(UI.deal);
    hand().forEach((c, i) => {
      const node = cardEl(c, ctx, { size: 'hand', selected: myTurn() && i === selected, disabled: !myTurn() });
      if (fresh[i]) {
        node.classList.add('deal'); // a drawn card slides in
        node.style.setProperty('--d', String(dealt++));
      }
      node.setAttribute('role', 'button');
      bindCard(node, i, cards);
      cards.append(node);
    });
    prevHand = hand().slice();
    root.append(cards);
    cards.scrollLeft = keepScroll;
    tick();
  }

  function tick(): void {
    if (!timerEl || !pub) return;
    const m = me();
    if (m?.out) timerEl.textContent = ctx.tr('Eliminated');
    else if (myTurn()) timerEl.textContent = `${ctx.tr('Your turn')} · ${Math.ceil(pub.tt)}s · ${ctx.tr('Plays left')} ${pub.left}${foes().length > 1 && pub.aim ? ` · ➜ ${ctx.labelOf(pub.aim)}` : ''}`;
    else timerEl.textContent = `${ctx.tr('Waiting for')} ${pub.turn ? ctx.labelOf(pub.turn) : ''}`;
    // the last seconds of your turn: amber, then red and blinking
    const tone = myTurn() && !m?.out ? timerTone(pub.tt, pub.ttMax) : 'ok';
    timerEl.classList.toggle('tt-warn', tone === 'warn');
    timerEl.classList.toggle('tt-urgent', tone === 'urgent');
  }

  // a new play changes the history: redraw it when it is open, else only the count on its button
  const unsubLog = playLog.subscribe(() => {
    if (!showLog) {
      if (logBtnEl) logBtnEl.textContent = logLabel();
      return;
    }
    if (dragging) dirty = true;
    else render();
  });

  // a player's screen has no table: the damage comet flies over the players strip instead
  setCometSink(drawComets);

  return {
    update(state: GameState | null, p: unknown) {
      pub = state as CardsState | null;
      priv = p as CardsPrivate | null;
      if (!pub) return;
      if (pub.turn !== prevTurn) {
        prevTurn = pub.turn;
        if (pub.turn === ctx.myId()) {
          ctx.big(ctx.tr('Your turn'));
          ctx.sound(UI.turn);
          try {
            navigator.vibrate?.(35);
          } catch {
            /* no vibration here */
          }
        }
      }
      // the cross moved the selection on the server: follow it
      if (priv && priv.cur !== seenCur) {
        seenCur = priv.cur;
        selected = priv.cur;
      }
      if (selected >= hand().length) selected = hand().length - 1;
      const m = me();
      const next = [hand().join(','), selected, pub.turn, pub.aim, pub.made, pub.left, pub.purge, m?.hp, m?.out, foes().map((f) => f.id + f.hp).join(',')].join('|');
      if (next !== sig) {
        sig = next;
        render();
      } else tick();
    },
    destroy() {
      setCometSink(null);
      unsubLog();
      cleanup?.();
      root.remove();
      style.remove();
    },
  };
}
