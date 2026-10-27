// Client half of Frost Shove: the ice floe, bears, power-ups and per-variant hazards.
import type { ClientGamePlugin } from '../../../core/client/src/plugins/api';
import type { FrostShoveState } from '../shared/types';
import { FrostShoveRenderer } from './FrostShoveRenderer';
import { LIGHTNING_COLOR, WEIGHT_COLOR, WEIGHT_FALL_MS, bearsNow, pushFx } from './effects';
import { POLAR_TRACK } from './track';

/** whether an energy bolt was warning last frame: the warning has no server event, so its start is detected here */
let boltWarn = false;

const plugin: ClientGamePlugin = {
  kinds: ['ext:frost-shove'],
  music: POLAR_TRACK,

  createRenderer: (ctx) => {
    const r = new FrostShoveRenderer(ctx);
    return {
      render: (host, a, b, latest, alpha) => r.render(host, a as FrostShoveState, b as FrostShoveState, latest as FrostShoveState, alpha),
      reset: () => r.reset(),
      markFallen: (id) => r.markFallen(id),
    };
  },

  /** Lightning going off, Weight dropping on its holder, an item passed on; the rest is the core's default */
  event(e, fx, ctx) {
    const m = ctx.motion();
    const burst = (x: number, y: number, tint: number, n: number, speed: number) => {
      const count = Math.round(n * m);
      if (count > 0) fx.burst(x, y, tint, count, speed);
    };
    if (e.kind === 'zap') {
      pushFx({ k: 'ring', x: e.x, y: e.y, dur: 600, r: 520, color: 0xffffff });
      pushFx({ k: 'ring', x: e.x, y: e.y, dur: 450, r: 300, color: LIGHTNING_COLOR });
      for (const p of bearsNow()) {
        if (p.id === e.id || !p.alive || p.fall > 0) continue;
        pushFx({ k: 'bolt', x: e.x, y: e.y, x2: p.x, y2: p.y, dur: 350, seed: p.x + p.y });
        pushFx({ k: 'flash', x: p.x, y: p.y, dur: 220, r: p.r + 10 });
        burst(p.x, p.y, LIGHTNING_COLOR, 10, 260);
      }
      burst(e.x, e.y, 0xffffff, 14, 320);
      fx.shake(150, 0.006);
      ctx.sfx('hazard');
      ctx.sound([
        { k: 'noise', d: 0.3, g: 0.2, from: 6000, to: 400 },
        { k: 'tone', f: 1400, to: 200, d: 0.25, type: 'sawtooth', g: 0.12 },
      ]);
      return true;
    }
    if (e.kind === 'ext:weight') {
      pushFx({ k: 'weight', x: e.x, y: e.y, dur: 900 });
      // the impact comes when it lands, not when the event arrives
      setTimeout(() => {
        burst(e.x, e.y, 0x8a8a8a, 18, 300);
        fx.shake(180, 0.008);
        ctx.sfx('explode');
      }, m > 0 ? WEIGHT_FALL_MS : 0);
      return true;
    }
    if (e.kind === 'ext:beam') {
      // the beam goes live
      ctx.sfx('powerup');
      burst(e.x, e.y, 0xffffff, 10, 200);
      return true;
    }
    if (e.kind === 'ext:melt') {
      burst(e.x, e.y, 0xff7a1a, 18, 280);
      burst(e.x, e.y, 0xbfe8ff, 10, 200);
      fx.shake(140, 0.006);
      ctx.sfx('splash');
      return true;
    }
    if (e.kind === 'ext:walrus') {
      // the walrus climbs onto the floe
      burst(e.x, e.y, 0xbfe8ff, 16, 260);
      fx.shake(120, 0.005);
      ctx.sfx('bump');
      return true;
    }
    if (e.kind === 'catch') {
      const to = bearsNow().find((p) => p.id === e.id);
      const color = to?.carry === 'weight' ? WEIGHT_COLOR : LIGHTNING_COLOR;
      if (to) pushFx({ k: 'streak', x: 2 * e.x - to.x, y: 2 * e.y - to.y, x2: to.x, y2: to.y, dur: 300, color });
      pushFx({ k: 'ring', x: to?.x ?? e.x, y: to?.y ?? e.y, dur: 350, r: 90, color });
      burst(e.x, e.y, color, 8, 220);
      ctx.sound([{ k: 'tone', f: 500, to: 1100, d: 0.12, type: 'square', g: 0.1 }]);
      return true;
    }
    return false;
  },

  hud(state, ctx) {
    const s = state as FrostShoveState;
    const me = s.players.find((p) => p.id === ctx.myId());
    if (me && !me.alive) return ctx.tr('You fell! Spectating');
    if (me && me.fall > 0) return ctx.tr('In the water! MASH the button!');
    const alive = s.players.filter((p) => p.alive).length;
    const secs = ctx.t('hud.seconds', { n: Math.max(0, Math.ceil(s.limit - s.t)) });
    return `${ctx.variantName(s.variant)}  -  ${ctx.t('hud.aliveLower', { n: alive })}  -  ${secs}`;
  },

  cue(state, phase, ctx) {
    if (phase !== 'playing') {
      boltWarn = false;
      return;
    }
    const warn = !!(state as FrostShoveState).bolts?.some((b) => b.warn > 0 && !b.on);
    if (warn && !boltWarn) ctx.sfx('warn');
    boltWarn = warn;
  },

  ranking(state, ctx) {
    return [...(state as FrostShoveState).players]
      .sort((a, b) => Number(b.alive) - Number(a.alive))
      .map((p) => ({ id: p.id, alive: p.alive, text: p.alive ? '' : ctx.t('spectate.out') }));
  },
};
export default plugin;
