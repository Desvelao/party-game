export type PanelKind = 'none' | 'results' | 'waiting-results' | 'waiting-finished';

/** Which end-of-game panel to draw for a phase; late joiners have no result / final data to show. */
export function endPanelFor(phase: string, hasResult: boolean, finalShown: boolean): PanelKind {
  if (phase === 'results') return hasResult ? 'results' : 'waiting-results';
  if (phase === 'finished') return finalShown ? 'none' : 'waiting-finished';
  return 'none';
}
