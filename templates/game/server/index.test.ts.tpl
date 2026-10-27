import { describe, expect, it } from 'vitest';
import plugin from './index';

const IDS = ['a', 'b', 'c'];

function play(seed = 1) {
  let s = seed;
  const rng = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const game = plugin.createMinigame('__ID__', { timeLimit: 10, orbs: 5 }, rng);
  game.init(IDS.map((id) => ({ id, name: id })));
  return game;
}

describe('__ID__', () => {
  it('runs to the end and places every player once', () => {
    const game = play();
    for (let i = 0; i < 60 * 12 && !game.isFinished(); i++) {
      for (const id of IDS) game.handleInput(id, { mx: Math.cos(i / 30), my: Math.sin(i / 30), a1: false, a2: false });
      game.update(1 / 60);
    }
    expect(game.isFinished()).toBe(true);
    expect(game.getPlacements().map((p) => p.id).sort()).toEqual(IDS);
  });

  it('snapshots stay a pack kind', () => {
    expect(play().getState().kind).toBe('ext:__ID__');
  });
});
