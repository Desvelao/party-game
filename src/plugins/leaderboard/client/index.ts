// Interface half of the leaderboard plugin: the "Top" page with a top-3 podium (bigger avatar = better rank), the
// ranking table, the game and period filters and the name search.
import type { ClientPlugin, ScreenContext } from '../../../core/client/src/plugins/features';
import { fetchLeaderboard, podiumSize, type LeaderboardPeriod, type LeaderboardRow, type LeaderboardSort } from './api';

function render(ctx: ScreenContext): HTMLElement {
  const { h, tr } = ctx;
  let sort: LeaderboardSort = 'wins';
  let game = '';
  let period: LeaderboardPeriod = 'all';
  let query = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  const body = h('div', {}, h('p', { class: 'sub' }, ctx.t('profile.loading')));
  const search = h('input', {
    type: 'search',
    maxLength: 24,
    'aria-label': tr('Search player'),
    placeholder: tr('Search player'),
    autocomplete: 'off',
    onInput: () => {
      query = search.value;
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    },
  });
  const sortBtn = (s: LeaderboardSort, label: string) =>
    h('button', { class: 'btn alt', 'aria-pressed': String(sort === s), onClick: () => { sort = s; load(); } }, label);
  const gameSel = h(
    'select',
    { class: 'sel', 'aria-label': tr('Game'), onChange: () => { game = gameSel.value; load(); } },
    h('option', { value: '' }, tr('All games')),
    ...ctx.games().map((g) => h('option', { value: g.id }, g.name)),
  );
  const periodNames: Record<LeaderboardPeriod, string> = { all: tr('All time'), week: tr('Last 7 days'), month: tr('Last 30 days') };
  const periodSel = h(
    'select',
    { class: 'sel', 'aria-label': tr('Period'), onChange: () => { period = periodSel.value as LeaderboardPeriod; load(); } },
    ...(['all', 'week', 'month'] as LeaderboardPeriod[]).map((p) => h('option', { value: p }, periodNames[p])),
  );
  const panel = h('div', { class: 'panel leaderboard' }, h('h2', {}, tr('Leaderboard')), ctx.presence(), search, h('div', { class: 'row' }, gameSel, periodSel), body);

  const avatar = (r: LeaderboardRow, size: number) => ctx.avatar(r, r.color, size);
  const table = (list: LeaderboardRow[]) =>
    h(
      'table',
      { class: 'mini lb-table' },
      h(
        'tr',
        {},
        h('th', {}, '#'),
        h('th', {}, tr('Player')),
        h('th', {}, ctx.t('profile.wins')),
        h('th', {}, ctx.t('profile.points')),
        h('th', {}, ctx.t('profile.matches')),
        h('th', {}, tr('Win %')),
        h('th', {}, ctx.t('profile.best')),
      ),
      ...list.map((r) =>
        h(
          'tr',
          {},
          h('td', {}, String(r.rank)),
          h('td', { class: 'lb-name' }, avatar(r, 24), r.name),
          h('td', {}, String(r.wins)),
          h('td', {}, String(r.points)),
          h('td', {}, String(r.matches)),
          h('td', {}, `${Math.round(r.winRate * 100)}%`),
          h('td', {}, String(r.bestMatchScore)),
        ),
      ),
    );

  const load = (): void => {
    const mine = ++seq;
    void fetchLeaderboard({ q: query, sort, game, period }).then((res) => {
      if (!panel.isConnected || mine !== seq) return;
      if (!res.ok) return body.replaceChildren(h('p', { class: 'err' }, ctx.t('status.unreachable')));
      const { top, results } = res.data;
      if (!top.length) return body.replaceChildren(h('p', { class: 'sub' }, tr('No players ranked yet.')));
      const podium = top.slice(0, 3);
      // second place on the left, first in the middle, third on the right
      const order = [podium[1], podium[0], podium[2]].filter((r): r is LeaderboardRow => !!r);
      const kids: HTMLElement[] = [
        h('div', { class: 'row' }, sortBtn('wins', tr('By wins')), sortBtn('points', tr('By points')), sortBtn('winrate', tr('By win rate'))),
        h('div', { class: 'podium' }, ...order.map((r) => h('div', { class: `podium-slot p${r.rank}` }, avatar(r, podiumSize(r.rank)), h('strong', {}, `${r.rank}. ${r.name}`)))),
      ];
      if (results) kids.push(h('h3', {}, tr('Search results')), results.length ? table(results) : h('p', { class: 'sub' }, tr('No player with that name.')));
      else kids.push(table(top));
      body.replaceChildren(...kids);
    });
  };

  panel.append(h('div', { class: 'row' }, h('button', { class: 'btn alt', onClick: () => ctx.back() }, ctx.t('profile.back'))));
  load();
  return panel;
}

const plugin: ClientPlugin = { screen: { path: '/leaderboard', navLabel: 'Top', render } };
export default plugin;
