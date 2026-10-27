import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin, { ACHIEVEMENT_IDS, ACHIEVEMENT_TEXT, renderProgress, type ProgressView } from './index';

afterEach(() => vi.unstubAllGlobals());

// a tiny stand-in for the DOM builder: nodes keep their tag, attributes and children
class Node {
  isConnected = true;
  constructor(public tag: string, public attrs: Record<string, string>, public kids: (Node | string)[]) {}
  replaceChildren(...k: (Node | string)[]) {
    this.kids = k;
  }
  get textContent(): string {
    return this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join('');
  }
  find(pred: (n: Node) => boolean): Node | undefined {
    if (pred(this)) return this;
    for (const k of this.kids) if (typeof k !== 'string') { const f = k.find(pred); if (f) return f; }
    return undefined;
  }
}
const h = ((tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string | null)[]) => new Node(tag, attrs, kids.filter((k): k is Node | string => k !== null))) as never;
const tr = (s: string) => s;
const view: ProgressView = { xp: 80, level: 2, into: 30, need: 100, matches: 3, wins: 1, streak: 1, bestStreak: 2, bests: { tank: 2 }, achievements: { 'first-win': 1 } };

describe('progression client', () => {
  it('has a text for every achievement', () => {
    expect(ACHIEVEMENT_IDS.length).toBeGreaterThan(0);
    for (const id of ACHIEVEMENT_IDS) expect(ACHIEVEMENT_TEXT[id]).toHaveLength(2);
  });

  it('draws level, bar, streak, achievements and best places', () => {
    const el = renderProgress({ h, tr } as never, view, { tank: 'Tank Wars' }) as unknown as Node;
    expect(el.textContent).toContain('Level 2');
    expect(el.textContent).toContain('70 XP to the next level');
    expect(el.textContent).toContain('Win streak: 1 (best 2)');
    expect(el.textContent).toContain('Tank Wars: #2');
    expect(el.find((n) => n.attrs.role === 'progressbar')?.attrs['aria-valuenow']).toBe('30');
    expect(el.textContent).toContain('★ First win');
    expect(el.textContent).toContain('☆ First match');
  });

  it('posts the profile key and fills the section', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(view)));
    vi.stubGlobal('fetch', fetchFn);
    const box = plugin.profileSection!({ h, tr, profileKey: 'k'.repeat(32), games: () => [{ id: 'tank', name: 'Tank Wars' }] } as never) as unknown as Node;
    await vi.waitFor(() => expect(box.textContent).toContain('Level 2'));
    expect(box.textContent).toContain('Tank Wars: #2');
    expect(fetchFn).toHaveBeenCalledWith('/api/progression', expect.objectContaining({ method: 'POST' }));
  });

  it('leaves the section empty when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('down');
    });
    const box = plugin.profileSection!({ h, tr, profileKey: 'k'.repeat(32), games: () => [] } as never) as unknown as Node;
    await new Promise((r) => setTimeout(r, 10));
    expect(box.textContent).toBe('');
  });
});
