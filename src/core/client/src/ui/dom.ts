export type Attrs = Record<string, unknown>;

/** Tiny DOM builder: `class`, `data-*`/`aria-*`/`role` as attributes, `onXxx` as listeners, the rest as properties. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role') el.setAttribute(k, String(v));
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (v !== undefined && v !== false) (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c) el.append(c);
  return el;
}
