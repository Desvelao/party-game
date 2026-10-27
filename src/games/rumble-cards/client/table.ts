// The rivals' panels on the shared strip, registered by Overlay so the hand can tell where a thrown card landed.
const panels = new Map<string, HTMLElement>();

export function registerPanel(id: string, el: HTMLElement): void {
  panels.set(id, el);
}

export function clearPanels(): void {
  panels.clear();
}

/** the player whose panel is under the screen point, if any */
export function panelAt(x: number, y: number): string | null {
  for (const [id, el] of panels) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
  }
  return null;
}

/** mark the panels of `ids` as places a card may be dropped (`hot`: the one under the finger); null clears */
export function markDrop(ids: string[] | null, hot: string | null = null): void {
  for (const [id, el] of panels) {
    el.classList.toggle('drop', !!ids && ids.includes(id));
    el.classList.toggle('hot', !!ids && id === hot);
  }
}

/** the screen point at the middle of a player's panel (where a card thrown at them flies to) */
export function panelCentre(id: string): { x: number; y: number } {
  const r = panels.get(id)?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: 80 };
}

/** the players who have a panel, and whether each is out (for effects that need to know who is still in) */
export function panelIds(): { id: string; out: boolean }[] {
  return [...panels].map(([id, el]) => ({ id, out: el.classList.contains('out') }));
}

export const panelEl = (id: string): HTMLElement | undefined => panels.get(id);
