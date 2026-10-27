// Interface half of the progression plugin: a block at the end of the profile's Info tab with the level and its XP bar,
// the win streak, the achievements and the best place in each game.
import type { ClientPlugin, ProfileContext } from '../../../core/client/src/plugins/features';

export interface ProgressView {
  xp: number;
  level: number;
  into: number;
  need: number;
  matches: number;
  wins: number;
  streak: number;
  bestStreak: number;
  bests: Record<string, number>;
  achievements: Record<string, number>;
}

/** English texts of the achievements (translated with `tr`, from the manifest's `locales`). */
export const ACHIEVEMENT_TEXT: Record<string, [title: string, hint: string]> = {
  'first-match': ['First match', 'Finish a match'],
  'first-win': ['First win', 'Win a match against other players'],
  'matches-10': ['Regular', 'Finish 10 matches'],
  'matches-50': ['Veteran', 'Finish 50 matches'],
  'streak-3': ['On fire', 'Win 3 matches in a row'],
  'streak-5': ['Unstoppable', 'Win 5 matches in a row'],
  'rounds-100': ['Centurion', 'Play 100 rounds'],
  'games-5': ['Explorer', 'Play 5 different games'],
  'level-5': ['Level 5', 'Reach level 5'],
};

/** Order of the achievement grid. */
export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENT_TEXT);

export async function fetchProgress(key: string): Promise<ProgressView | null> {
  try {
    const res = await fetch('/api/progression', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    return res.ok ? ((await res.json()) as ProgressView) : null;
  } catch {
    return null;
  }
}

export function renderProgress(ctx: Pick<ProfileContext, 'h' | 'tr'>, p: ProgressView, gameNames: Record<string, string> = {}): HTMLElement {
  const { h, tr } = ctx;
  const pct = Math.max(0, Math.min(100, Math.round((p.into / Math.max(1, p.need)) * 100)));
  const bests = Object.entries(p.bests).sort((a, b) => a[1] - b[1]);
  return h(
    'div',
    { class: 'progression' },
    h('h2', {}, tr('Progress')),
    h('p', {}, h('b', {}, tr('Level {n}').replace('{n}', String(p.level))), ` · ${p.xp} XP`),
    h('div', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.need), 'aria-valuenow': String(p.into), style: 'height:10px;border-radius:5px;background:rgba(128,128,128,.3);overflow:hidden;max-width:320px' }, h('div', { style: `height:100%;width:${pct}%;background:currentColor` })),
    h('p', { class: 'hint' }, tr('{n} XP to the next level').replace('{n}', String(Math.max(0, p.need - p.into)))),
    h('p', {}, tr('Win streak: {n} (best {best})').replace('{n}', String(p.streak)).replace('{best}', String(p.bestStreak))),
    h('h3', {}, tr('Achievements')),
    h(
      'ul',
      { class: 'achievements', style: 'list-style:none;padding:0;display:grid;gap:6px' },
      ...ACHIEVEMENT_IDS.map((id) => {
        const [title, hint] = ACHIEVEMENT_TEXT[id]!;
        const got = id in p.achievements;
        return h('li', { style: got ? '' : 'opacity:.5' }, `${got ? '★' : '☆'} `, h('b', {}, tr(title)), ` — ${tr(hint)}`);
      }),
    ),
    bests.length ? h('h3', {}, tr('Best places')) : null,
    bests.length ? h('ul', { style: 'list-style:none;padding:0' }, ...bests.map(([id, place]) => h('li', {}, `${gameNames[id] ?? id}: ${tr('#{n}').replace('{n}', String(place))}`))) : null,
  );
}

const plugin: ClientPlugin = {
  profileSection(ctx) {
    const box = ctx.h('div', {});
    const names: Record<string, string> = {};
    void fetchProgress(ctx.profileKey).then((p) => {
      if (!p || !box.isConnected) return;
      for (const g of ctx.games()) names[g.id] = g.name;
      box.replaceChildren(renderProgress(ctx, p, names));
    });
    return box;
  },
};
export default plugin;
