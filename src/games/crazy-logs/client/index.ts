// Client half of Crazy Logs: river, logs and hopping players.
import type { ClientGamePlugin } from '../../../core/client/src/plugins/api';
import type { LogsState } from '../shared/types';
import { CrazyLogsRenderer } from './CrazyLogsRenderer';
import { LOGS_TRACK } from './track';

const KIND = 'ext:crazy-logs';

const plugin: ClientGamePlugin = {
  kinds: [KIND],
  music: LOGS_TRACK,

  createRenderer: (ctx) => {
    const r = new CrazyLogsRenderer(ctx);
    return { render: (host, a, b, latest, alpha) => r.render(host, a, b, latest, alpha), reset: () => r.reset() };
  },

  hud(state, ctx) {
    const s = state as LogsState;
    const me = s.players.find((p) => p.id === ctx.myId());
    const secs = ctx.t('hud.seconds', { n: Math.max(0, Math.ceil(s.limit - s.t)) });
    if (me && me.w > 0) return `${ctx.t('hud.splash')}  -  ${ctx.t('hud.pts', { n: me.score })}  -  ${secs}`;
    return me ? `${ctx.t('hud.pts', { n: me.score })}  -  ${secs}` : secs;
  },

  ranking(state, ctx) {
    return [...(state as LogsState).players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ id: p.id, alive: p.alive, text: ctx.t('hud.pts', { n: p.score }) }));
  },

  // hopping makes a different sound from the other games' dashes
  event(e, fx, ctx) {
    if (e.kind !== 'dash') return false;
    ctx.sfx('hop');
    fx.burst(e.x, e.y, ctx.colorOf(e.id), 6, 160);
    return true;
  },
};
export default plugin;
