import { describe, expect, it } from 'vitest';
import { ALL_PLAYABLES, effectiveDefaults } from '../../shared';
import { REGISTERED_IDS } from '../../server/minigames';
import { factoryIds, makeGame } from './factories';

describe('balance factories', () => {
  it('cover exactly the registered minigames', () => {
    expect([...factoryIds()].sort()).toEqual([...REGISTERED_IDS].sort());
    expect(factoryIds().sort()).toEqual(ALL_PLAYABLES.map((p) => p.id).sort());
  });

  it('build a playable game for every variant', () => {
    for (const id of factoryIds()) {
      const g = makeGame(id, effectiveDefaults(id), 1);
      g.init([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      for (let i = 0; i < 60; i++) g.update(1 / 60);
      expect(g.getState()).toBeTruthy();
    }
  });

  it('rejects an unknown id', () => {
    expect(() => makeGame('nope', {}, 1)).toThrow(/no minigame/);
  });
});
