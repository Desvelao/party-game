// Client half of __NAME__: how a snapshot looks. Draw on host.g (cleared every frame).
import type { ClientGamePlugin } from '__SRC__/client/src/plugins/api';
import { TRACK } from './track';

interface Snap {
  kind: string;
  t: number;
  limit: number;
  players: { id: string; x: number; y: number; score: number; gone: boolean }[];
  orbs: { x: number; y: number }[];
}

const plugin: ClientGamePlugin = {
  kinds: ['ext:__ID__'],
  music: TRACK,

  createRenderer(ctx) {
    return {
      render(host, a, b, latest, alpha) {
        const g = host.g;
        const from = a as unknown as Snap;
        const to = b as unknown as Snap;
        const now = latest as unknown as Snap;
        g.fillStyle(0xffd23f, 1);
        for (const o of now.orbs) g.fillCircle(o.x, o.y, 16);
        for (const p of now.players) {
          if (p.gone) continue;
          const p0 = from.players.find((x) => x.id === p.id) ?? p;
          const p1 = to.players.find((x) => x.id === p.id) ?? p;
          const x = ctx.lerp(p0.x, p1.x, alpha);
          const y = ctx.lerp(p0.y, p1.y, alpha);
          g.fillStyle(ctx.colorOf(p.id), 1).fillCircle(x, y, 24);
          const label = host.label(p.id);
          label.setPosition(x, y - 30);
        }
      },
    };
  },

  hud(state, ctx) {
    const s = state as unknown as Snap;
    const me = s.players.find((p) => p.id === ctx.myId());
    const left = Math.max(0, Math.ceil(s.limit - s.t));
    return `${me ? `${ctx.t('hud.pts', { n: me.score })}  -  ` : ''}${ctx.t('hud.seconds', { n: left })}`;
  },

  ranking(state, ctx) {
    const s = state as unknown as Snap;
    return s.players.map((p) => ({ id: p.id, alive: !p.gone, text: ctx.t('hud.pts', { n: p.score }) })).sort((x, y) => y.text.localeCompare(x.text, undefined, { numeric: true }));
  },

  event(e, fx, ctx) {
    if (e.kind !== 'pickup') return false;
    ctx.sfx('powerup');
    fx.burst(e.x, e.y, ctx.colorOf(e.id), 8, 200);
    return true;
  },
};
export default plugin;
