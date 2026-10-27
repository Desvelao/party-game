import { describe, expect, it } from 'vitest';
import { CATALOG, optionsFor } from '../../../core/shared/catalog';
import { groupOf } from '../../../core/shared/option-groups';

const game = () => CATALOG.find((c) => c.id === 'ballistix')!;
/** the options every variant starts with: the leading ones they all share */
const coreOptionIds = (): string[] => {
  const lists = game().variants.map((v) => optionsFor('ballistix', v.id).map((o) => o.id));
  const core: string[] = [];
  for (let i = 0; lists.every((l) => l[i] === lists[0][i]); i++) core.push(lists[0][i]);
  return core;
};

describe('Ballistix variants share the core options', () => {
  it('has a substantial shared core', () => {
    expect(coreOptionIds().length).toBeGreaterThan(10);
  });

  it('every variant offers every core option, labelled the same, in core order', () => {
    const core = coreOptionIds();
    const first = optionsFor('ballistix', game().variants[0].id);
    for (const v of game().variants) {
      const opts = optionsFor('ballistix', v.id);
      expect(opts.slice(0, core.length).map((o) => o.id)).toEqual(core);
      for (const [i, id] of core.entries()) {
        const o = opts[i];
        const ref = first[i];
        expect({ id, label: o.label, type: o.type, step: o.step, unit: o.unit }).toEqual({ id, label: ref.label, type: ref.type, step: ref.step, unit: ref.unit });
      }
    }
  });
});

describe('option groups of a feature', () => {
  it('all repulsion power-up settings share one section', () => {
    const repel = game().variants.flatMap((v) => v.options ?? []).filter((o) => o.id.startsWith('repel'));
    expect(new Set(repel.map((o) => groupOf(o)))).toEqual(new Set(['powerups']));
    expect([...new Set(repel.map((o) => o.id))]).toEqual(['repelEnabled', 'repelEvery', 'repelVariance', 'repelItemLife', 'repelItemVariance', 'repelDuration', 'repelDurationVariance', 'repelForce', 'repelRadius']);
  });
});
