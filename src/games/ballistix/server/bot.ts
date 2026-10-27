import { rotQuarter } from '../shared/geometry';
import { C } from './core/geometry';
import type { BallArenaState } from '../shared/types';
import type { InputState } from '../../../core/shared/types';

/** Slide the paddle under the nearest ball heading for this side's goal; press the boost when it is close. */
export function greedyBalls(s: BallArenaState, id: string): InputState {
  const me = s.paddles.find((p) => p.id === id);
  if (!me || !me.alive) return { mx: 0, my: 0, a1: false, a2: false };
  let best = 0;
  let bestDepth = -Infinity;
  let near = false;
  for (const b of s.balls) {
    if (b.wait) continue;
    // side frame: goal line at the bottom, so a larger depth means closer to this goal
    const [lx, depth] = rotQuarter(b.x - C, b.y - C, 4 - me.side);
    if (depth > bestDepth) {
      bestDepth = depth;
      best = lx;
      near = depth > 300;
    }
  }
  if (bestDepth === -Infinity) return { mx: 0, my: 0, a1: false, a2: false };
  const d = best - me.pos;
  return { mx: Math.abs(d) < 8 ? 0 : d > 0 ? 1 : -1, my: 0, a1: near, a2: false };
}
