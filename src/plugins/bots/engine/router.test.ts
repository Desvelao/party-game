import { describe, expect, it } from 'vitest';
import type { GameAi as GamePlugin } from '../../../core/shared/ai';
import { ballistix } from '../../../games/ballistix/bot';
import { registerGame } from './registry';

registerGame(ballistix);
import { AiRouter } from './router';

const dummy: GamePlugin = { id: 'dummy', kind: 'ext:dummy', policies: ['p'], defaultPolicy: 'p', defaultParams: {}, levels: { calm: {}, wild: {} }, defaultLevel: 'calm', create: () => null as never };

describe('AiRouter', () => {
  const r = new AiRouter({ level: 'hard', levels: { dummy: 'wild' }, policies: { ballistix: 'greedy' }, params: { aim: 0.3 } });

  it('plans a bot for a game that has an AI', () => {
    expect(r.supports({ game: 'ballistix' })).toEqual({ ok: true, games: ['ballistix'] });
    expect(r.plan({ game: 'ballistix', variant: 'cloud-orbs' })).toEqual({ gameId: 'ballistix', level: 'hard', policy: 'greedy', params: { aim: 0.3 } });
  });

  it('does not join games without an AI', () => {
    expect(r.supports({ game: 'frost-shove' }).ok).toBe(false);
    expect(r.plan({ game: 'frost-shove' })).toBeNull();
  });

  it('skips the mixed rotation unless allowed', () => {
    expect(r.supports({ game: 'mixed' }).ok).toBe(false);
    expect(new AiRouter({ level: 'normal', mixed: 'always' }).supports({ game: 'mixed' }).ok).toBe(true);
  });

  it('custom playlists: any known game is enough (default), or every game with playlistJoin all', () => {
    expect(r.supports({ game: 'custom', playlist: [{ game: 'ballistix' }, { game: 'ballistix', variant: 'sand-orb' }] }).ok).toBe(true);
    const partial = { game: 'custom', playlist: [{ game: 'ballistix' }, { game: 'tank-wars' }] };
    expect(r.supports(partial)).toEqual({ ok: true, games: ['ballistix'] });
    expect(r.plan(partial)?.gameId).toBe('ballistix');
    expect(new AiRouter({ level: 'normal', playlistJoin: 'all' }).supports(partial)).toEqual({ ok: false, reason: 'no AI for tank-wars' });
    expect(r.supports({ game: 'custom', playlist: [{ game: 'tank-wars' }, { game: 'frost-shove' }] })).toEqual({ ok: false, reason: 'no AI for tank-wars, frost-shove' });
  });

  it('uses per-game levels, falls back for unknown ones and can pick at random', () => {
    expect(new AiRouter({ level: 'calm', levels: { dummy: 'wild' } }, () => [dummy]).plan({ game: 'dummy' })?.level).toBe('wild');
    expect(new AiRouter({ level: 'godlike' }, () => [dummy]).plan({ game: 'dummy' })?.level).toBe('calm');
    expect(new AiRouter({ level: 'random' }, () => [dummy], () => 0.9).plan({ game: 'dummy' })?.level).toBe('wild');
  });

  it('lets a manual add pick the level, ignoring unknown names', () => {
    expect(r.plan({ game: 'ballistix' }, { level: 'easy' })?.level).toBe('easy');
    expect(r.plan({ game: 'ballistix' }, { level: 'godlike' })?.level).toBe('hard');
    expect(['easy', 'normal', 'hard', 'expert', 'semigod']).toContain(r.plan({ game: 'ballistix' }, { level: 'random' })?.level);
  });

  it('lists the games with an AI for the dashboard', () => {
    expect(r.catalog().map((g) => g.id)).toContain('ballistix');
  });
});
