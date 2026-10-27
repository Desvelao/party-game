import { describe, expect, it } from 'vitest';
import { UsageError } from './args';
import { parseScript, playtest, scriptedInput } from './playtest';

describe('playtest', () => {
  const script = parseScript(JSON.stringify({ options: { timeLimit: 20 }, inputs: [{ t: 0, player: 0, mx: 1 }, { t: 2, player: 0, my: -1, a1: true }] }));

  it('holds each scripted input until the next one', () => {
    expect(scriptedInput(script, 0, 1)).toEqual({ mx: 1, my: 0, a1: false, a2: false });
    expect(scriptedInput(script, 0, 2)).toEqual({ mx: 0, my: -1, a1: true, a2: false });
    expect(scriptedInput(script, 1, 5)).toEqual({ mx: 0, my: 0, a1: false, a2: false });
  });

  it('plays a seeded round to the end, deterministically', () => {
    const a = playtest('frost-classic', script, { players: 2, seed: 4 });
    expect(a.finished).toBe(true);
    expect(a.placements).toHaveLength(2);
    expect(playtest('frost-classic', script, { players: 2, seed: 4 })).toEqual(a);
  });

  it('reports failed expectations', () => {
    const r = playtest('frost-classic', { ...script, expect: { finished: false } }, { seed: 4 });
    expect(r.failures).toHaveLength(1);
  });

  it('rejects a bad script', () => {
    expect(() => parseScript('{oops')).toThrow(UsageError);
    expect(() => parseScript('{"inputs":[{"t":"x","player":0}]}')).toThrow(UsageError);
  });
});
