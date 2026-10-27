// Server half of __NAME__: the simulation. The core owns lobby, countdown, scoring and networking.
import type { Minigame, ServerGamePlugin } from '__SRC__/shared/plugin-api';

import { ORB_R, PLAYER_R, SPEED, WORLD, readOptions } from './config';
import type { Orb } from '../shared/types';

interface Player {
  id: string;
  x: number;
  y: number;
  mx: number;
  my: number;
  score: number;
  gone: boolean;
}

function create(playableId: string, options: Record<string, number | boolean | string>, rng: () => number): Minigame {
  const { limit, orbCount } = readOptions(options);
  let players: Player[] = [];
  let orbs: Orb[] = [];
  let t = 0;
  const events: { kind: 'pickup'; id: string; x: number; y: number }[] = [];
  const spawn = (): Orb => ({ x: 60 + rng() * (WORLD - 120), y: 60 + rng() * (WORLD - 120) });

  return {
    id: playableId,
    name: '__NAME__',
    init(list) {
      players = list.map((p, i) => ({
        id: p.id,
        x: WORLD / 2 + Math.cos((i / list.length) * Math.PI * 2) * 300,
        y: WORLD / 2 + Math.sin((i / list.length) * Math.PI * 2) * 300,
        mx: 0,
        my: 0,
        score: 0,
        gone: false,
      }));
      orbs = Array.from({ length: orbCount }, spawn);
    },
    handleInput(id, input) {
      const p = players.find((x) => x.id === id);
      if (p) [p.mx, p.my] = [input.mx, input.my];
    },
    removePlayer(id) {
      const p = players.find((x) => x.id === id);
      if (p) p.gone = true;
    },
    // optional: a player who left comes back while the round runs (without it they sit the round out)
    addPlayer(p) {
      const q = players.find((x) => x.id === p.id);
      if (q) q.gone = false;
    },
    // optional: extra numbers per player, sent with the round result
    getStats() {
      return Object.fromEntries(players.map((p) => [p.id, { score: p.score }]));
    },
    update(dt) {
      t += dt;
      for (const p of players) {
        if (p.gone) continue;
        p.x = Math.min(WORLD, Math.max(0, p.x + p.mx * SPEED * dt));
        p.y = Math.min(WORLD, Math.max(0, p.y + p.my * SPEED * dt));
        for (let i = 0; i < orbs.length; i++) {
          if (Math.hypot(orbs[i].x - p.x, orbs[i].y - p.y) < PLAYER_R + ORB_R) {
            p.score++;
            events.push({ kind: 'pickup', id: p.id, x: orbs[i].x, y: orbs[i].y });
            orbs[i] = spawn();
          }
        }
      }
    },
    getState() {
      // kinds of games from packs always start with "ext:"
      return {
        kind: 'ext:__ID__',
        t,
        limit,
        players: players.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), score: p.score, gone: p.gone })),
        orbs: orbs.map((o) => ({ x: Math.round(o.x), y: Math.round(o.y) })),
      };
    },
    drainEvents() {
      return events.splice(0);
    },
    isFinished() {
      return t >= limit || players.every((p) => p.gone);
    },
    getPlacements() {
      // everyone who joined is placed, including players who left; ties share a place
      const ranked = [...players].sort((a, b) => b.score - a.score);
      return ranked.map((p) => ({ id: p.id, place: 1 + ranked.filter((q) => q.score > p.score).length }));
    },
  };
}

const plugin: ServerGamePlugin = {
  createMinigame: (playableId, options, rng = Math.random) => create(playableId, options, rng),
};
export default plugin;
