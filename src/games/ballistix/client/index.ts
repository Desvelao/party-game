// Client half of Ballistix: the field, goals, paddles and balls, plus one view per variant feature.
import type { ClientGamePlugin } from '../../../core/client/src/plugins/api';
import type { BallArenaState } from '../shared/types';
import { BallistixRenderer } from './BallistixRenderer';
import { BALLISTIX_TRACK } from './track';
import { BALLISTIX_VIEWS } from './views';

const plugin: ClientGamePlugin = {
  kinds: ['ext:ballistix'],
  music: BALLISTIX_TRACK,

  createRenderer: (ctx) => {
    const r = new BallistixRenderer(ctx);
    return { render: (host, a, b, latest, alpha) => r.render(host, a as BallArenaState, b as BallArenaState, latest as BallArenaState, alpha) };
  },

  hud(state, ctx) {
    const s = state as BallArenaState;
    const me = s.paddles.find((p) => p.id === ctx.myId());
    if (!me) return ctx.tr('Spectating');
    const side = s.sides[me.side];
    if (!side?.alive) return ctx.tr('Your goal is closed! Spectating');
    const secs = ctx.t('hud.seconds', { n: Math.max(0, Math.ceil(s.limit - s.t)) });
    return `${ctx.variantName(s.variant)}  -  ${ctx.t('hud.lives', { n: side.lives })}  -  ${secs}`;
  },

  // variant features (magnet, enemy, engines, ...) react to their own events; the rest uses the core's effects
  event(e, fx, ctx) {
    for (const v of BALLISTIX_VIEWS) if (v.handleEvent?.(e, fx, ctx)) return true;
    return false;
  },

  ranking(state, ctx) {
    const s = state as BallArenaState;
    return s.paddles
      .map((p) => {
        const lives = s.sides[p.side]?.lives ?? 0;
        const alive = p.alive && lives > 0;
        return { id: p.id, alive, text: alive ? ctx.t('hud.lives', { n: lives }) : ctx.t('spectate.out'), key: p.alive ? lives : -1 };
      })
      .sort((a, b) => b.key - a.key)
      .map(({ key: _key, ...entry }) => entry);
  },
};
export default plugin;
