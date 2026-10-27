// Client half of Rumble Cards: the table on the shared screen, the hand on each phone.
import type { ClientGamePlugin } from '../../../core/client/src/plugins/api';
import { CARDS } from '../shared/cards';
import type { CardsState } from '../shared/types';
import { calm, damageOf, effectFor } from './anim';
import { createBoard } from './Board';
import { floatText, pulsePanel } from './effects';
import { BLOCK, BREAK, DISCARD, DISCARD_AUTO, HEAL_CHIME, KNOCK_OUT, castSound, hitSound, tickSound } from './sounds';
import { fireComets } from './comets';
import { playLog } from './history';
import { impactDelay, noteCast } from './timing';
import { createController } from './Controller';
import { createOverlay } from './Overlay';
import { CARDS_TRACK } from './track';

const plugin: ClientGamePlugin = {
  kinds: ['ext:rumble-cards'],
  createRenderer: createBoard,
  controller: createController,
  controllerKeepsControls: true,
  moveControl: () => 'cross',
  actionLabels: (state, ctx) => ({ a1: ctx.tr((state as unknown as CardsState | null)?.purge ? 'Discard' : 'Play'), a2: ctx.tr('End turn') }),
  overlay: createOverlay,
  music: CARDS_TRACK,

  hud(state, ctx) {
    const s = state as unknown as CardsState;
    const who = s.turn ? ctx.labelOf(s.turn) : '';
    const play = s.purge > 0 ? `  -  ${ctx.tr('Discard')} ${s.purge}` : s.last ? `  -  ${ctx.labelOf(s.last.p)}: ${ctx.tr(CARDS[s.last.c].name)}` : '';
    return who ? `${ctx.tr('Turn')}: ${who} (${Math.ceil(s.tt)}s)${play}` : null;
  },

  ranking(state, ctx) {
    const s = state as unknown as CardsState;
    return [...s.players]
      .sort((a, b) => Number(a.out) - Number(b.out) || b.hp - a.hp)
      .map((p) => ({ id: p.id, alive: !p.out, text: p.out ? ctx.tr('Eliminated') : `♥ ${p.hp}` }));
  },

  event(e, fx, ctx) {
    // the server adds an amount `n` (hit points lost or recovered, damage absorbed) to some events
    const n = Math.max(1, Number((e as { n?: number }).n) || 1);
    playLog.add(e as unknown as Parameters<typeof playLog.add>[0]);
    /** a hit or heal shows and sounds when the card that caused it arrives, not when it is cast */
    const onImpact = (fn: () => void) => {
      const wait = impactDelay();
      if (wait <= 0) return fn();
      setTimeout(() => {
        try {
          fn();
        } catch {
          /* the round ended and the scene is gone */
        }
      }, wait);
    };
    switch (e.kind) {
      case 'ext:play': {
        // a card was cast: its sound and flight start together, from this one event
        const c = Number((e as { c?: number }).c);
        if (!Number.isInteger(c) || !CARDS[c]) return true;
        const { kind, color } = effectFor(c);
        ctx.sound(castSound(c));
        const dmg = damageOf(c);
        if (dmg.single || dmg.all) fireComets({ single: dmg.single, all: dmg.all, p: e.id, tg: String((e as { tg?: string }).tg ?? ''), color });
        noteCast({ c, p: e.id, tg: String((e as { tg?: string }).tg ?? ''), kind, color, hits: dmg.single || dmg.all });
        return true;
      }
      case 'hit':
        onImpact(() => {
          ctx.sound(hitSound(n));
          floatText(e.id, `-${n}`, '#ff5d73', 40);
          pulsePanel(e.id, 'hurt');
          fx.burst(e.x, e.y, 0xe5484d, 6 + n * 4, 190 + n * 30);
          if (!calm()) fx.shake(160 + n * 50, 0.006 + 0.005 * Math.min(n, 3));
        });
        return true;
      case 'heal':
        onImpact(() => {
          ctx.sound(HEAL_CHIME);
          floatText(e.id, `+${n}`, '#5dff9b');
          pulsePanel(e.id, 'heal');
          fx.burst(e.x, e.y, 0x2fbf71, 6 + n * 3, 140);
        });
        return true;
      case 'eliminated':
        onImpact(() => {
          ctx.sound(KNOCK_OUT);
          pulsePanel(e.id, 'ko');
          fx.burst(e.x, e.y, 0xffffff, 26, 320);
          fx.burst(e.x, e.y, 0xe5484d, 14, 220);
          if (!calm()) fx.shake(320, 0.014);
        });
        return true;
      case 'ext:block':
        onImpact(() => {
          ctx.sound(BLOCK);
          floatText(e.id, `🛡 ${n}`, '#7fd4ff');
          pulsePanel(e.id, 'guarded');
          fx.burst(e.x, e.y, 0x4fc3ff, 6 + n * 2, 160);
        });
        return true;
      case 'ext:discard': {
        // a card thrown away: chosen by the player, or taken from them at random when their time ran out
        const c = Number((e as { c?: number }).c);
        const auto = !!(e as { auto?: boolean }).auto;
        ctx.sound(auto ? DISCARD_AUTO : DISCARD);
        floatText(e.id, `🗑 ${CARDS[c] ? ctx.tr(CARDS[c].name) : ''}`.trim(), '#ffb36b');
        pulsePanel(e.id, 'discard');
        fx.burst(e.x, e.y, auto ? 0x9a8f86 : 0xffb36b, auto ? 12 : 7, auto ? 210 : 150);
        if (auto && !calm()) fx.shake(140, 0.005);
        return true;
      }
      case 'ext:tick': {
        // the last seconds of a turn: a tick for everyone, the panel flashes, and the phone of the player on turn buzzes
        ctx.sound(tickSound(Number((e as { n?: number }).n) || 1));
        if (!calm()) pulsePanel(e.id, 'urgent');
        if (e.id === ctx.myId()) {
          try {
            navigator.vibrate?.(n <= 1 ? [30, 40, 30] : 20);
          } catch {
            /* no vibration here */
          }
        }
        return true;
      }
      case 'ext:guard':
        fx.burst(e.x, e.y, 0x4fc3ff, 10, 190);
        return true;
      case 'ext:break':
        onImpact(() => {
          ctx.sound(BREAK);
          floatText(e.id, '💥', '#ffb36b');
          fx.burst(e.x, e.y, 0xffb36b, 14, 260);
          if (!calm()) fx.shake(160, 0.007);
        });
        return true;
      default:
        return false;
    }
  },
};
export default plugin;
