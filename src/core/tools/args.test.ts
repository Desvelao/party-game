import { describe, expect, it } from 'vitest';
import { UsageError, flagValue, parseArgs } from './args';

describe('parseArgs', () => {
  it('splits words, flags and values', () => {
    const p = parseArgs(['install', 'a.pgpack', '--yes', '--dir', '/x', '--name=y'], ['dir', 'name']);
    expect(p.words).toEqual(['install', 'a.pgpack']);
    expect(p.flags.get('yes')).toBe(true);
    expect(flagValue(p, 'dir')).toBe('/x');
    expect(flagValue(p, 'name')).toBe('y');
    expect(flagValue(p, 'yes')).toBeUndefined();
  });
  it('-- ends options and -h means help', () => {
    expect(parseArgs(['--', '--not-a-flag']).words).toEqual(['--not-a-flag']);
    expect(parseArgs(['-h']).flags.get('help')).toBe(true);
  });
  it('a value flag without a value is a usage error', () => {
    expect(() => parseArgs(['--dir'], ['dir'])).toThrow(UsageError);
  });
});
