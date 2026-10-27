// DOM effects over the table: floating numbers, panel flashes. Needs the overlay to be mounted (it holds the panels).
import { calm } from './anim';
import { panelCentre, panelEl } from './table';

/** at most this many floating texts at once (low-spec phones) */
const MAX_FLOATS = 10;
let floats = 0;

/** A number or sign that rises from a player's panel and fades out. */
export function floatText(id: string, text: string, color: string, size = 26): void {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('overlay');
  if (!host || !panelEl(id) || floats >= MAX_FLOATS) return;
  const c = panelCentre(id);
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:fixed;left:${c.x}px;top:${c.y}px;z-index:7;pointer-events:none;font:900 ${size}px system-ui,sans-serif;color:${color};text-shadow:0 2px 0 #1b1426,0 0 8px #1b1426;transform:translate(-50%,-50%)`;
  host.append(el);
  floats++;
  const rise = calm() ? 0 : 46;
  const anim = el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { transform: 'translate(-50%,-70%) scale(1.25)', opacity: 1, offset: 0.2 },
      { transform: `translate(-50%,calc(-50% - ${rise + 14}px)) scale(1)`, opacity: 0 },
    ],
    { duration: 950, easing: 'ease-out' },
  );
  anim.onfinish = () => {
    el.remove();
    floats--;
  };
}

/** Flash a player's panel (a CSS class that removes itself): `hurt`, `heal`, `guarded`, `discard`, `urgent` (the last seconds) or `ko`. */
export function pulsePanel(id: string, cls: 'hurt' | 'heal' | 'guarded' | 'ko' | 'discard' | 'urgent'): void {
  const el = panelEl(id);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  if (cls !== 'ko') setTimeout(() => el.classList.remove(cls), 600);
}
