import { afterEach, describe, expect, it } from 'vitest';
import { registerCharacterModels, unregisterCharacterModels, type Shape } from '../../../shared';
import { characterShapes, registerDraws, resetDraws } from './characters';

const ROBOT = { id: 'robot', name: 'Robot', slots: [{ id: 'head', label: 'Head', options: [{ label: 'A' }, { label: 'B' }], default: 0 }] };
const OWNER = { kind: 'plugin', id: 'robots' } as const;
const square: Shape = { k: 'poly', pts: [0, 0, 1, 0, 1, 1, 0, 1], fill: 1 };

afterEach(() => {
  unregisterCharacterModels(OWNER);
  resetDraws();
});

describe('client character models', () => {
  it('draws a registered model with its owner code', () => {
    registerCharacterModels(OWNER, [ROBOT]);
    registerDraws(OWNER, { robot: () => [square] });
    expect(characterShapes('robot', { head: 1 }, 5, 10, 0)).toEqual([square]);
  });

  it('ignores draw code from another owner or for unknown models', () => {
    registerCharacterModels(OWNER, [ROBOT]);
    registerDraws({ kind: 'game', id: 'other' }, { robot: () => [square], ghost: () => [square] });
    expect(characterShapes('robot', {}, 5, 10, 0)).toEqual([{ k: 'circle', x: 0, y: 0, r: 10, fill: 5 }]);
  });

  it('falls back to a plain body when the model is missing, empty or throws', () => {
    expect(characterShapes(undefined, {}, 7, 3, 0)).toEqual([{ k: 'circle', x: 0, y: 0, r: 3, fill: 7 }]);
    registerCharacterModels(OWNER, [ROBOT]);
    registerDraws(OWNER, { robot: () => { throw new Error('broken'); } });
    expect(characterShapes('robot', {}, 7, 3, 0)).toHaveLength(1);
    resetDraws();
    registerDraws(OWNER, { robot: () => [] });
    expect(characterShapes('robot', {}, 7, 3, 0)[0]).toMatchObject({ k: 'circle', fill: 7 });
  });
});
