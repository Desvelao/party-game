// Client half of Spring Showdown: the tile board, pogo hoppers, items and the scoreboard.
import type { ClientGamePlugin } from '../../../core/client/src/plugins/api';
import type { PogoState } from '../shared/types';
import { PogoRenderer } from './PogoRenderer';
import { POGO_TRACK } from './track';

const plugin: ClientGamePlugin = {
  kinds: ['ext:spring-showdown'],
  music: POGO_TRACK,

  createRenderer: (ctx) => {
    const r = new PogoRenderer(ctx);
    return { render: (host, a, b, latest, alpha) => r.render(host, a as PogoState, b as PogoState, latest as PogoState, alpha) };
  },

  hud(state, ctx) {
    const s = state as PogoState;
    const me = s.players.find((p) => p.id === ctx.myId());
    const secs = ctx.t('hud.seconds', { n: Math.max(0, Math.ceil(s.limit - s.t)) });
    const name = ctx.variantName(s.variant);
    if (!me) return `${name}  -  ${secs}`;
    return `${name}  -  ${ctx.t('hud.pts', { n: me.score })}${me.stun ? `  -  ${ctx.tr('STUNNED')}` : ''}  -  ${secs}`;
  },

  ranking(state, ctx) {
    return [...(state as PogoState).players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ id: p.id, alive: !p.gone, text: ctx.t('hud.pts', { n: p.score }) }));
  },
};
export default plugin;
