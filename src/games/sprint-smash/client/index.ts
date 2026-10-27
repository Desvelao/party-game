// Client half of Sprint Smash: ring track, variant scenery, pickups and hovercrafts.
import type { ClientGamePlugin, ClientContext } from '../../../core/client/src/plugins/api';
import type { DashState } from '../shared/types';
import { DashRenderer } from './DashRenderer';
import { DASH_TRACK } from './track';

const KIND = 'ext:sprint-smash';

/** "Lap 3/10" in the player's language */
const lapText = (ctx: ClientContext, n: number, m: number) => `${ctx.tr('Lap')} ${n}/${m}`;

/** the lap this player was on last frame: a lap completed has no server event, so the edge is detected here */
let myLap = -1;

const plugin: ClientGamePlugin = {
  kinds: [KIND],
  music: DASH_TRACK,

  createRenderer: (ctx) => {
    const r = new DashRenderer(ctx);
    return { render: (host, a, b, latest, alpha) => r.render(host, a as DashState, b as DashState, latest as DashState, alpha), reset: () => r.reset() };
  },

  hud(state, ctx) {
    const s = state as DashState;
    const me = s.players.find((p) => p.id === ctx.myId());
    const secs = ctx.t('hud.seconds', { n: Math.max(0, Math.ceil(s.limit - s.t)) });
    const lap = me ? Math.min(s.laps, Math.floor(me.p) + 1) : 0;
    const stat = me ? `${lapText(ctx, lap, s.laps)}  -  ` : '';
    return `${ctx.variantName(s.variant)}  -  ${stat}${secs}`;
  },

  cue(state, phase, ctx) {
    if (phase !== 'playing') {
      myLap = -1;
      return;
    }
    const s = state as DashState;
    const me = s.players.find((p) => p.id === ctx.myId());
    if (!me) return;
    const lap = Math.floor(me.p);
    if (myLap >= 0 && lap > myLap && lap < s.laps) {
      ctx.sfx('lap');
      ctx.big(lapText(ctx, lap + 1, s.laps));
    }
    myLap = lap;
  },

  ranking(state, ctx) {
    const s = state as DashState;
    return s.players
      .map((p) => {
        const lap = Math.min(s.laps, Math.floor(p.p) + 1);
        return { id: p.id, alive: true, text: p.fin ? ctx.tr('finished') : lapText(ctx, lap, s.laps), key: p.fin ? 1000 + (s.laps - p.p) : p.p };
      })
      .sort((a, b) => b.key - a.key)
      .map(({ key: _key, ...entry }) => entry);
  },
};
export default plugin;
