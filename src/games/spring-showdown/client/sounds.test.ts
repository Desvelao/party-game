import { describe, expect, it } from 'vitest';
import { sanitizeSound } from '../../../core/client/src/audio/recipe';
import { BOOTS_SOUNDS, MISSILE_SOUNDS, bootsSound, missileSounds, type MissilePos } from './sounds';

const m = (id: number, x: number, y: number) => ({ id, x, y });

describe('missile sounds', () => {
  it('every recipe is already inside the core limits', () => {
    for (const steps of [...Object.values(MISSILE_SOUNDS), ...Object.values(BOOTS_SOUNDS)]) expect(sanitizeSound(steps)).toMatchObject(steps);
  });

  it('a new missile plays once, a four-way volley too; nothing on the first frame', () => {
    const prev = new Map<number, MissilePos>();
    expect(missileSounds(prev, [m(1, 3.5, 3)], 8, true)).toEqual([]);
    expect(missileSounds(prev, [m(1, 4, 3), m(2, 4, 3), m(3, 4, 3), m(4, 4, 3), m(5, 5, 5)], 8, false)).toEqual(['launch']);
    expect(missileSounds(prev, [m(1, 4.5, 3), m(2, 4.5, 3), m(3, 4.5, 3), m(4, 4.5, 3), m(5, 5, 5)], 8, false)).toEqual([]);
  });

  it('Blast Bot missiles, spawned on the edge, play the bomber sound', () => {
    const prev = new Map<number, MissilePos>();
    missileSounds(prev, [], 8, true);
    expect(missileSounds(prev, [m(7, 3.5, 0.01)], 8, false)).toEqual(['bomber']);
  });

  it('a missile that vanishes inside the board is a hit, past the edge it is not', () => {
    const prev = new Map<number, MissilePos>();
    missileSounds(prev, [m(1, 4, 3), m(2, 7.8, 3)], 8, true);
    expect(missileSounds(prev, [], 8, false)).toEqual(['hit']);
    missileSounds(prev, [m(3, 7.8, 3)], 8, false);
    expect(missileSounds(prev, [], 8, false)).toEqual([]);
  });

  describe('boots', () => {
    it('pulses every 300 ms while active and hurries in the last 1.5 s', () => {
      expect(bootsSound(0.9, 0.9, 200, 0)).toBeNull();
      expect(bootsSound(0.9, 0.9, 300, 0)).toBe('zip');
      expect(bootsSound(0.15, 0.15, 200, 0)).toBe('hurry');
      expect(bootsSound(0.15, 0.15, 100, 0)).toBeNull();
    });

    it('plays the end once on the edge to 0 and is otherwise silent', () => {
      expect(bootsSound(0.02, 0, 5000, 0)).toBe('end');
      expect(bootsSound(0, 0, 5100, 0)).toBeNull();
    });
  });
});
