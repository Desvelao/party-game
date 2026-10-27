import { describe, expect, it } from 'vitest';
import { endPanelFor } from './panel';

describe('endPanelFor', () => {
  it('draws results only when a result is known', () => {
    expect(endPanelFor('results', true, false)).toBe('results');
    expect(endPanelFor('results', false, false)).toBe('waiting-results');
  });
  it('waits in finished until the final screen was drawn', () => {
    expect(endPanelFor('finished', false, false)).toBe('waiting-finished');
    expect(endPanelFor('finished', false, true)).toBe('none');
  });
  it('ignores other phases', () => {
    expect(endPanelFor('lobby', false, false)).toBe('none');
    expect(endPanelFor('playing', true, false)).toBe('none');
  });
});
