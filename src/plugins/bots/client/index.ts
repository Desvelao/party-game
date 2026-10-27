// Interface half of the bots plugin: the host's controls in the lobby, and the bot tags in the player list.
import type { ClientPlugin, FeatureContext } from '../../../core/client/src/plugins/features';

interface RoomState {
  fill: boolean;
  level: string;
  seats: { id: string; level: string }[];
  /** why the bots the host asked for cannot come */
  note?: { code: string; detail?: string };
}

const LEVELS = ['easy', 'normal', 'hard', 'expert', 'semigod', 'random'] as const;

const noteText = (ctx: FeatureContext, note: NonNullable<RoomState['note']>): string => {
  switch (note.code) {
    case 'no-ai': return ctx.tr('No bot can play this room: {detail}').replace('{detail}', note.detail ? ctx.tr(note.detail) : '');
    case 'paused': return ctx.tr('Joining of bots is paused');
    case 'limit': return ctx.tr('The most bots are playing already');
    case 'cooldown': return ctx.tr('Bots are waiting a moment before trying again');
    default: return ctx.tr('No bot can read this room');
  }
};

const levelName = (ctx: FeatureContext, level: string): string => {
  switch (level) {
    case 'easy': return ctx.tr('Easy');
    case 'hard': return ctx.tr('Hard');
    case 'expert': return ctx.tr('Expert');
    case 'semigod': return ctx.tr('Semigod');
    case 'random': return ctx.tr('Random');
    default: return ctx.tr('Normal');
  }
};

function levelSelect(ctx: FeatureContext, value: string, fid: string, label: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = ctx.h('select', { 'data-fid': fid, 'aria-label': label, onChange: () => onChange(sel.value) }, ...LEVELS.map((l) => ctx.h('option', { value: l, selected: l === value }, levelName(ctx, l))));
  return sel;
}

const removeButton = (ctx: FeatureContext, id: string): HTMLElement =>
  ctx.h('button', { class: 'btn icon alt', 'data-fid': `bot-remove-${id}`, title: ctx.tr('Remove bot'), 'aria-label': ctx.tr('Remove bot'), onClick: () => ctx.send({ a: 'remove', id }) }, '✕');

const plugin: ClientPlugin = {
  lobbyHost(ctx) {
    const st = ctx.state<RoomState>();
    if (!st) return null;
    let addLevel = st.level;
    return ctx.h(
      'div',
      { class: 'bots-controls' },
      ctx.h('div', { class: 'slot-name' }, ctx.tr('Bots')),
      ctx.h(
        'div',
        { class: 'row' },
        ctx.h('button', { class: 'btn small' + (st.fill ? '' : ' alt'), 'data-fid': 'host-bots-fill', 'aria-pressed': String(st.fill), onClick: () => ctx.send({ a: 'fill', on: !st.fill }) }, st.fill ? ctx.tr('Stop filling with bots') : ctx.tr('Fill room with bots')),
      ),
      ctx.h('div', { class: 'row' }, ctx.h('span', { class: 'slot-name' }, ctx.tr('Bot level')), levelSelect(ctx, st.level, 'host-bots-level', ctx.tr('Bot level'), (v) => ctx.send({ a: 'level', level: v }))),
      st.note ? ctx.h('p', { class: 'sub', style: 'margin:4px 0;color:var(--accent2)', role: 'status' }, `⚠ ${noteText(ctx, st.note)}`) : null,
      ctx.h('div', { class: 'row' }, levelSelect(ctx, addLevel, 'host-bots-add-level', ctx.tr('Level of the bot to add'), (v) => (addLevel = v)), ctx.h('button', { class: 'btn small', 'data-fid': 'host-bots-add', onClick: () => ctx.send({ a: 'add', level: addLevel }) }, ctx.tr('Add bot'))),
    );
  },

  lobbyInfo(ctx) {
    const st = ctx.state<RoomState>();
    return st?.fill ? ctx.h('p', { class: 'sub', style: 'margin:0 0 6px' }, `🤖 ${ctx.tr('Bots fill the empty seats ({level})').replace('{level}', levelName(ctx, st.level))}`) : null;
  },

  lobbyRow(player, ctx) {
    const info = ctx.playerState<{ level?: string; added?: boolean }>(player.id);
    if (!info) return null;
    return { tag: `🤖 ${levelName(ctx, info.level ?? 'normal')}`, actions: info.added && ctx.isHost() ? ctx.h('span', { class: 'actions' }, removeButton(ctx, player.id)) : undefined };
  },

  lobbyRows(ctx) {
    const st = ctx.state<RoomState>();
    return (st?.seats ?? []).map((s) =>
      ctx.h('li', {}, ctx.h('span', { class: 'grow' }, `🤖 ${ctx.tr('Bot {level} (joining...)').replace('{level}', levelName(ctx, s.level))}`), ctx.isHost() ? ctx.h('span', { class: 'actions' }, removeButton(ctx, s.id)) : null),
    );
  },
};
export default plugin;
