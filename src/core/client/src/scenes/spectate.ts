import type { GameState } from '../../../shared';
import { t } from '../../../shared';
import { session } from '../session';
import type { RankEntry } from '../plugins/api';
import { context, pluginForKind } from '../plugins/registry';

export type { RankEntry };

/** Live standings of the running round, best first; the game's own plugin decides (none = no ranking shown). */
export function rankingOf(s: GameState): RankEntry[] {
  return pluginForKind(s.kind)?.ranking?.(s, context) ?? [];
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** DOM overlay for spectators: live ranking, elimination feed and the follow-camera controls. */
export class SpectatorHud {
  private readonly root = document.getElementById('spec-hud') as HTMLDivElement;
  private readonly rank = document.getElementById('spec-rank') as HTMLOListElement;
  private readonly feed = document.getElementById('spec-feed') as HTMLDivElement;
  private readonly cam = document.getElementById('spec-cam') as HTMLDivElement;
  private readonly camLabel = document.getElementById('spec-cam-label') as HTMLSpanElement;
  private rankKey = '';
  private shown = false;

  constructor(private readonly onStep: (dir: -1 | 1) => void, private readonly onFree: () => void) {
    document.getElementById('spec-prev')?.addEventListener('click', () => this.onStep(-1));
    document.getElementById('spec-next')?.addEventListener('click', () => this.onStep(1));
    this.camLabel.addEventListener('click', () => this.onFree());
    window.addEventListener('keydown', (e) => {
      if (!this.shown || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') this.onStep(1);
      else if (e.key === 'ArrowLeft') this.onStep(-1);
      else if (e.key === 'Escape') this.onFree();
    });
  }

  show(on: boolean): void {
    this.shown = on;
    this.root.hidden = !on;
    if (!on) {
      this.rankKey = '';
      this.feed.replaceChildren();
    }
  }

  /** Repaints only when the standings (or who is followed) changed. */
  setRanking(entries: RankEntry[], followId: string): void {
    const key = `${session.spectators}|${followId}|${entries.map((e) => `${e.id}:${e.text}`).join(',')}`;
    if (key === this.rankKey) return;
    this.rankKey = key;
    const rows = entries.slice(0, 8).map((e, i) => {
      const li = document.createElement('li');
      li.className = `${e.alive ? '' : 'out'}${e.id === followId ? ' follow' : ''}`.trim();
      const dot = document.createElement('i');
      dot.style.background = hex(session.colorOf(e.id));
      const name = session.players.find((p) => p.id === e.id)?.name ?? '';
      li.append(`${i + 1}. `, dot, ` ${name} `);
      const sub = document.createElement('span');
      sub.textContent = e.text;
      li.append(sub);
      return li;
    });
    if (session.spectators > 0) {
      const w = document.createElement('li');
      w.className = 'watchers';
      w.textContent = `\u{1F441} ${t('lobby.watching', { n: session.spectators })}`;
      rows.push(w);
    }
    this.rank.replaceChildren(...rows);
    const followed = entries.find((e) => e.id === followId);
    this.camLabel.textContent = followed ? t('spectate.following', { name: session.players.find((p) => p.id === followId)?.name ?? '' }) : t('spectate.overview');
  }

  pushFeed(text: string): void {
    const line = document.createElement('div');
    line.textContent = text;
    this.feed.append(line);
    while (this.feed.childElementCount > 4) this.feed.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 5000);
  }
}
