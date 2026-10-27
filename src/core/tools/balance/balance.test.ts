import { describe, expect, it } from 'vitest';
import { ALL_PLAYABLES, playerLimitOf } from '../../shared';
import { report } from './report';
import { runOne, type Row } from './runner';
import { SCENARIOS, alternatives, buildSweep, optionPoints, policiesFor, type RunSpec } from './sweep';

const spec = (variant: string, over: Partial<RunSpec> = {}): RunSpec => ({ variant, options: {}, playerCount: 2, seed: 3, scenario: 'random', ...over });

describe('balance runner', () => {
  it('is deterministic for a variant and seed', () => {
    for (const variant of ['smashball', 'frost-classic', 'spring-painter']) {
      const s = spec(variant, { options: { timeLimit: 30 } });
      expect(runOne(s)).toEqual(runOne(s));
    }
  });

  it('plays one round per family to an end and places every player', () => {
    for (const variant of ['smashball', 'frost-classic', 'spring-painter', 'jungle-bonanza', 'dot-sprint', 'jungle-fox', 'crazy-logs']) {
      const rows = runOne(spec(variant, { playerCount: 3, scenario: 'greedy', options: { timeLimit: variant === 'smashball' ? 30 : 20 } }));
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => !r.timedOut && r.place >= 1 && r.place <= 3)).toBe(true);
      expect(rows.map((r) => r.slot)).toEqual([0, 1, 2]);
    }
  });

  it('differs between seeds', () => {
    const a = runOne(spec('frost-classic', { seed: 1 }));
    const b = runOne(spec('frost-classic', { seed: 2 }));
    expect(a).not.toEqual(b);
  });
});

describe('balance sweep', () => {
  it('moves one option at a time to its min, max and the other values', () => {
    expect(alternatives({ id: 'x', label: '', description: '', type: 'number', default: 5, min: 1, max: 9 })).toEqual([1, 9]);
    expect(alternatives({ id: 'x', label: '', description: '', type: 'number', default: 1, min: 1, max: 9 })).toEqual([9]);
    expect(alternatives({ id: 'x', label: '', description: '', type: 'boolean', default: true })).toEqual([false]);
    const points = optionPoints('smashball', true);
    expect(points[0]).toEqual({});
    expect(points.length).toBeGreaterThan(1);
    expect(points.every((p) => Object.keys(p).length <= 1 && !('roundsToWin' in p))).toBe(true);
    expect(optionPoints('smashball', false)).toEqual([{}]);
  });

  it('skips player counts a variant cannot hold', () => {
    const limited = ALL_PLAYABLES.find((p) => playerLimitOf(p.id) !== undefined)!.id;
    const max = playerLimitOf(limited)!;
    const specs = buildSweep({ variants: [limited], players: [2, max + 1], seeds: 1, scenarios: ['random'], options: false });
    expect(specs.every((s) => s.playerCount <= max)).toBe(true);
    expect(specs.length).toBe(1);
  });

  it('rotates the special bot through the slots', () => {
    const slots = new Set([1, 2, 3, 4].map((seed) => policiesFor(spec('smashball', { playerCount: 4, seed, scenario: 'skill' })).indexOf('greedy')));
    expect(slots.size).toBe(4);
    expect(SCENARIOS).toContain('idle');
  });
});

describe('balance report', () => {
  it('summarises a small sweep without flagging draws as wins', () => {
    const rows: Row[] = [];
    for (const scenario of SCENARIOS) for (let seed = 1; seed <= 3; seed++) rows.push(...runOne(spec('frost-classic', { seed, scenario, options: { timeLimit: 30 } })));
    const { text } = report(rows);
    expect(text).toContain('DURATION');
    expect(text).toContain('frost-classic');
    const draw: Row[] = [0, 1].map((slot) => ({ ...rows[0], slot, place: 1, firstPlaces: 2, playerCount: 2, scenario: 'random' as const }));
    expect(report(draw).text).toContain('SPAWN SLOT');
  });
});
