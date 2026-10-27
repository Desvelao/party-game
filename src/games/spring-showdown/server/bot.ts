// Greedy bot for `npm run balance`.
import type { InputState } from '../../../core/shared/types';
import type { PogoState } from '../shared/types';

/** Hop towards the nearest tile somebody else owns (or nobody does); bank by pressing the button now and then. */
export function greedyPogo(s: PogoState, id: string, rng: () => number): InputState {
  const idx = s.players.findIndex((p) => p.id === id);
  const me = s.players[idx];
  if (!me || me.gone) return { mx: 0, my: 0, a1: false, a2: false };
  const n = s.size;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < s.tiles.length; i++) {
    if (s.tiles[i] === idx || s.tiles[i] < -1) continue;
    const d = Math.abs((i % n) - me.c) + Math.abs(Math.floor(i / n) - me.r);
    if (d > 0 && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  let mx = 0;
  let my = 0;
  if (best >= 0) {
    const dc = (best % n) - me.c;
    const dr = Math.floor(best / n) - me.r;
    if (Math.abs(dc) >= Math.abs(dr)) mx = Math.sign(dc);
    else my = Math.sign(dr);
  }
  return { mx, my, a1: me.item !== '' || rng() < 0.05, a2: false };
}
