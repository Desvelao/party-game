import type { GameState, InputState } from '../../../shared';

interface Body {
  id: string;
  x: number;
  y: number;
  alive?: boolean;
}

const IDLE: InputState = { mx: 0, my: 0, a1: false, a2: false };

/**
 * Chase the nearest living opponent and press the buttons when close. Deliberately simple: it
 * measures whether "approach and attack" beats random play, not how good a player can get.
 * Games with their own rules ship a bot in their pack; a game without x/y bodies falls back to random.
 */
export function greedyGeneric(s: GameState, id: string, rng: () => number): InputState {
  const bodies = (s as { players?: Body[] }).players;
  if (!Array.isArray(bodies)) return IDLE;
  const me = bodies.find((p) => p.id === id);
  if (!me || me.alive === false) return IDLE;
  let best: Body | undefined;
  let bestD = Infinity;
  for (const o of bodies) {
    if (o.id === id || o.alive === false) continue;
    const d = Math.hypot(o.x - me.x, o.y - me.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  if (!best) return IDLE;
  const len = bestD || 1;
  return { mx: (best.x - me.x) / len, my: (best.y - me.y) / len, a1: bestD < 140 || rng() < 0.05, a2: bestD < 90 };
}
