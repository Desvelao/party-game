import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARDS, HEROES } from '../shared/cards';
import { MOTIFS, artSvg } from './art';

/** every opening tag has its closing tag or is self-closed */
function balanced(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== tag) return false;
    } else stack.push(tag);
  }
  return stack.length === 0;
}

describe('card art', () => {
  it('draws every motif as well-formed SVG', () => {
    for (const [name, body] of Object.entries(MOTIFS)) expect(balanced(`<svg>${body}</svg>`), name).toBe(true);
  });

  it('gives every card an illustration with unique gradient ids', () => {
    const ids = new Set<string>();
    CARDS.forEach((c, i) => {
      expect(MOTIFS[c.art.m], c.name).toBeTruthy();
      const svg = artSvg(c.art, HEROES[0].color);
      expect(svg.startsWith('<svg') && balanced(svg), c.name).toBe(true);
      const id = /id="(rcg\d+)"/.exec(svg)?.[1] ?? '';
      expect(ids.has(id), `${c.name} #${i}`).toBe(false);
      ids.add(id);
    });
  });

  it('translates every card name and note into Spanish', () => {
    const es = (JSON.parse(readFileSync(new URL('../game.json', import.meta.url), 'utf8')) as { locales: { es: Record<string, string> } }).locales.es;
    for (const c of CARDS) {
      expect(es[c.name], c.name).toBeTruthy();
      if (c.note) expect(es[c.note], c.note).toBeTruthy();
    }
  });
});
