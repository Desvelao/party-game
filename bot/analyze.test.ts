import { describe, expect, it } from 'vitest';
import { buildSummary, type Run } from './summary';

const round = (gameId: string, variant: string, myPlace: number, myPoints: number, metrics: Record<string, number> = {}) => ({
  index: 0, gameId, variant, durationS: 30, myPlace, myPoints, placements: [], incidents: 0, incidentCauses: {}, metrics,
});
const run = (name: string, policy: string, rounds: ReturnType<typeof round>[]): Run => ({
  name,
  group: '',
  m: {
    startedAt: '2026-01-01T00:00:00Z', room: 'ABCD', name: 'bot', level: 'normal', policy, params: { a: 1 },
    serverConfig: { tickRate: 30, networkRate: 15 }, rounds, latency: { rttMs: null, snapshotGapMs: null },
  },
});

const at = new Date('2026-01-01T00:00:00Z');

describe('buildSummary', () => {
  const md = buildSummary(
    [
      run('a', 'ballistix', [round('ballistix', 'classic', 1, 10, { hits: 4, goalsConceded: 2 }), round('ballistix', 'classic', 2, 6, { hits: 2 })]),
      run('b', 'frost-shove', [round('frost-shove', 'classic', 1, 8)]),
    ],
    '/nonexistent',
    at,
  );

  it('has a results row for every game, not only Ballistix', () => {
    expect(md).toContain('## Results by game / policy / parameters / variant');
    expect(md).toContain('| ballistix | ballistix | normal | classic | 2 | 50% | 1.5 | 8.0 |');
    expect(md).toContain('| frost-shove | frost-shove | normal | classic | 1 | 100% | 1.0 | 8.0 |');
  });

  it('lists the parameter sets of every game', () => {
    expect(md).toContain('- frost-shove / frost-shove normal / classic: `{"a":1}`');
  });

  it('keeps the Ballistix columns in an extra table with Ballistix rows only', () => {
    const extra = md.split('## Ballistix: extra columns')[1].split('\n## ')[0];
    expect(extra).toContain('| ballistix | normal | classic | 2 | 1.0 | 3.0 |');
    expect(extra).not.toContain('frost-shove');
  });

  it('omits the Ballistix table when there is no Ballistix round', () => {
    expect(buildSummary([run('b', 'frost-shove', [round('frost-shove', 'classic', 1, 8)])], '/nonexistent', at)).not.toContain('Ballistix: extra columns');
  });
});
