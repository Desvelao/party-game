import { describe, expect, it } from 'vitest';
import type { BallArenaState } from '../../shared/types';
import { makeFrame } from '../frame';
import { platformWarp } from './platform';

const state = (variant: string, pulls: number[] = [0, 0, 0, 0]): BallArenaState => ({
  kind: 'ext:ballistix',
  variant,
  t: 0,
  limit: 100,
  boostRadius: 150,
  sides: [],
  paddles: [],
  balls: [],
  engines: pulls.map((pull) => ({ phase: pull > 0 ? 'fail' : 'ok', left: 0.5, pull })),
});
/** screen offset of a point of the deck */
const at = (s: BallArenaState, x: number, y: number, turn = 0, motion = 0, now = 1234) => {
  const w = platformWarp(s, s, s, 0, now, turn, motion)!;
  return w.at(x, y);
};

describe('Cloud Orbs platform', () => {
  it('only Cloud Orbs has one', () => {
    expect(platformWarp(state('smashball'), state('smashball'), state('smashball'), 0, 0, 0, 1)).toBeNull();
  });

  it('is still without motion and without a failure', () => {
    const s = state('cloud-orbs');
    for (const [x, y] of [[100, 100], [500, 500], [900, 900]]) expect(at(s, x, y)).toEqual([0, 0]);
  });

  it('floats when motion is allowed, and only then', () => {
    const s = state('cloud-orbs');
    expect(at(s, 500, 500, 0, 1)[1]).not.toBe(0);
    expect(at(s, 500, 500, 0, 0)[1]).toBe(0);
  });

  it('drops the corner of the failing engine, more as the pull grows, and leaves the far one', () => {
    // world corner 0 is top-left; with no turn that is the screen's top-left
    const half = at(state('cloud-orbs', [0.5, 0, 0, 0]), 100, 100);
    const full = at(state('cloud-orbs', [1, 0, 0, 0]), 100, 100);
    expect(full[1]).toBeGreaterThan(half[1]);
    expect(half[1]).toBeGreaterThan(0);
    // pulled towards the middle too
    expect(full[0]).toBeGreaterThan(0);
    expect(at(state('cloud-orbs', [1, 0, 0, 0]), 900, 900)).toEqual([0, 0]);
    // the centre follows by a quarter of the corner (bilinear blend)
    expect(at(state('cloud-orbs', [1, 0, 0, 0]), 500, 500)[1]).toBeCloseTo(full[1] / 4, 5);
  });

  it('follows the corner to wherever the viewer sees it', () => {
    const s = state('cloud-orbs', [0, 1, 0, 0]); // world top-right
    // turned a quarter, the world's top-right is the screen's bottom-right
    const w = platformWarp(s, s, s, 0, 0, 1, 0)!;
    expect(w.drop[2]).toBe(1);
    expect(w.at(900, 900)[0]).toBeLessThan(0); // pulled in towards the middle
    expect(w.at(100, 100)).toEqual([0, 0]);
  });

  it('moves what sits on the deck but not the engine point', () => {
    const s = state('cloud-orbs', [1, 0, 0, 0]);
    const w = platformWarp(s, s, s, 0, 0, 0, 0)!;
    const f = makeFrame({ g: null, label: () => null } as never, s, s, s, 0, 0, w, 0);
    expect(f.W0(140, 140)).toEqual([140, 140]);
    expect(f.W(140, 140)[1]).toBeGreaterThan(140);
    expect(f.S(0, 0, 400)[0]).toBeCloseTo(f.S0(0, 0, 400)[0] + w.at(...f.S0(0, 0, 400))[0], 5);
  });
});
