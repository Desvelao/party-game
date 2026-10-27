// Client half of Box Bonanza: arena floor, crates, pick-ups, shots, penguin and fighters.
import type { ClientGamePlugin } from '../../../core/client/src/plugins/api';
import type { CrateState } from '../shared/types';
import { CrateRenderer } from './CrateRenderer';
import { CRATES_TRACK } from './track';

const plugin: ClientGamePlugin = {
  kinds: ['ext:box-bonanza'],
  music: CRATES_TRACK,

  createRenderer: (ctx) => {
    const r = new CrateRenderer(ctx);
    return {
      render: (host, a, b, latest, alpha) => r.render(host, a as CrateState, b as CrateState, latest as CrateState, alpha),
      reset: () => r.reset(),
      markFallen: (id) => r.markFallen(id),
    };
  },

  hud(state, ctx) {
    const s = state as CrateState;
    const me = s.players.find((p) => p.id === ctx.myId());
    const alive = s.players.filter((p) => p.alive).length;
    const name = ctx.variantName(s.variant);
    const secs = ctx.t('hud.seconds', { n: Math.max(0, Math.ceil(s.limit - s.t)) });
    if (me && !me.alive) return ctx.t('hud.out');
    if (!me) return `${name}  -  ${ctx.t('hud.aliveLower', { n: alive })}  -  ${secs}`;
    return `${name}  -  ${ctx.t('hud.hp')} ${Math.ceil(me.hp)}/${s.maxHp}  -  ${ctx.t('hud.aliveLower', { n: alive })}  -  ${secs}`;
  },

  ranking(state, ctx) {
    return [...(state as CrateState).players]
      .sort((a, b) => (b.alive ? b.hp : -1) - (a.alive ? a.hp : -1))
      .map((p) => ({ id: p.id, alive: p.alive, text: p.alive ? `${Math.ceil(p.hp)} ${ctx.t('hud.hp')}` : ctx.t('spectate.out') }));
  },
};
export default plugin;
