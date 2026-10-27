import { beforeAll, describe, expect, it } from 'vitest';
import { seededIds } from '../../src/core/server/minigames';
import { registerSourceGames } from '../../src/core/server/plugins/sourceGames';
import { coerceCliOption, coerceCliOptions } from './options';

beforeAll(async () => {
  if (!seededIds().length) await registerSourceGames();
});

describe('coerceCliOption', () => {
  it('follows the declared type', () => {
    expect(coerceCliOption({ type: 'choice' } as never, '2')).toBe('2');
    expect(coerceCliOption({ type: 'number' } as never, '3')).toBe(3);
    expect(coerceCliOption({ type: 'boolean' } as never, 'true')).toBe(true);
    expect(coerceCliOption({ type: 'boolean' } as never, 'false')).toBe(false);
  });
  it('guesses from the text without a definition', () => {
    expect(coerceCliOption(undefined, 'true')).toBe(true);
    expect(coerceCliOption(undefined, '4')).toBe(4);
    expect(coerceCliOption(undefined, 'auto')).toBe('auto');
    expect(coerceCliOption(undefined, '')).toBe('');
  });
});

describe('coerceCliOptions', () => {
  it('keeps a choice option as a string and a number option as a number', () => {
    expect(coerceCliOptions([['balls', '2'], ['lives', '3']], 'ballistix', 'smashball')).toEqual({ balls: '2', lives: 3 });
  });
});
