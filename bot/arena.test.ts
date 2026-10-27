import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { seededIds } from '../src/core/server/minigames';
import { registerSourceGames } from '../src/core/server/plugins/sourceGames';
import { parseSeats, seatNames, validateScenario, type Scenario } from './arena';
import './games';

beforeAll(async () => {
  if (!seededIds().length) await registerSourceGames();
});

describe('scenarios', () => {
  it('parses seat shorthand', () => {
    expect(parseSeats('hard, normal,human')).toEqual([{ bot: 'hard' }, { bot: 'normal' }, { human: true }]);
  });

  it('gives duplicate seats distinct names', () => {
    const sc: Scenario = { name: 'x', seats: [{ bot: 'hard' }, { bot: 'hard' }, { human: true }] };
    expect(seatNames(sc, 1)).toEqual(['Hard-1', 'Hard-2', 'Human']);
    expect(seatNames({ ...sc, rooms: 2 }, 2)).toEqual(['Hard-1.R2', 'Hard-2.R2', 'Human.R2']);
  });

  it('rejects scenarios that cannot run', () => {
    expect(validateScenario({ name: 'x', seats: [{ human: true }] })).toHaveLength(1);
    expect(validateScenario({ name: 'x', seats: [{ bot: 'godlike' }] })[0]).toMatch(/unknown level/);
    expect(validateScenario({ name: 'x', seats: Array(5).fill({ bot: 'easy' }) })).not.toHaveLength(0);
  });

  it('every shipped scenario file is valid', () => {
    const dir = join(__dirname, 'scenarios');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const sc = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Scenario;
      expect(validateScenario(sc), f).toEqual([]);
    }
  });
});
