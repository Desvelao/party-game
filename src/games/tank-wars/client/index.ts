// Client half of Tank Wars: arena, walls, tanks (rotor boats in Swamp Fox), shots and mines.
import type { ClientGamePlugin } from '../../../core/client/src/plugins/api';
import type { TankState } from '../shared/types';
import { TankRenderer } from './TankRenderer';
import { TANKS_TRACK } from './track';

const KIND = 'ext:tank-wars';

const plugin: ClientGamePlugin = {
  kinds: [KIND],
  music: TANKS_TRACK,

  createRenderer: (ctx) => {
    const r = new TankRenderer(ctx);
    return {
      render: (host, a, b, latest, alpha) => r.render(host, a, b, latest, alpha),
      reset: () => r.reset(),
      markFallen: (id) => r.markFallen(id),
    };
  },

  hud(state, ctx) {
    const s = state as TankState;
    const me = s.players.find((p) => p.id === ctx.myId());
    const alive = s.players.filter((p) => p.alive).length;
    const secs = ctx.t('hud.seconds', { n: Math.max(0, Math.ceil(s.limit - s.t)) });
    const name = ctx.variantName(s.variant);
    if (me && !me.alive) return ctx.t('hud.out');
    if (!me) return `${name}  -  ${ctx.t('hud.aliveLower', { n: alive })}  -  ${secs}`;
    return `${name}  -  ${ctx.t('hud.hp')} ${Math.ceil(me.hp)}/${s.maxHp}  -  ${ctx.t('hud.mines', { n: me.mines })}  -  ${ctx.t('hud.aliveLower', { n: alive })}  -  ${secs}`;
  },

  ranking(state, ctx) {
    return [...(state as TankState).players]
      .sort((a, b) => (b.alive ? b.hp : -1) - (a.alive ? a.hp : -1))
      .map((p) => ({ id: p.id, alive: p.alive, text: p.alive ? `${Math.ceil(p.hp)} ${ctx.t('hud.hp')}` : ctx.t('spectate.out') }));
  },

  // the cannon has its own sound; everything else uses the core's effects
  event(e, fx, ctx) {
    if (e.kind !== 'throw' && e.kind !== 'kick') return false;
    ctx.sfx('cannon');
    fx.burst(e.x, e.y, 0xffffff, 5, 160);
    return true;
  },

  // tanks on rails turn at junctions, so four directions suit them better than a joystick
  moveControl: (state) => ((state as TankState).rails === true ? 'cross' : undefined),
};
export default plugin;
