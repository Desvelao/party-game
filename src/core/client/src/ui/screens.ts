import {
  ALL_VARIANTS,
  ALL_VARIANTS_DESCRIPTION,
  CATALOG,
  CONTROL_ACTIONS,
  CUSTOM,
  DEFAULT_SELECTION,
  EMPTY_PRESETS,
  LANGS,
  LANG_FLAGS,
  LANG_NAMES,
  EMOTES,
  MOTION_LEVELS,
  defaultEmoteKeys,
  MAX_KEYS_PER_ACTION,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PLAYLIST,
  MAX_TEAMS,
  TEAM_PALETTE,
  selectionSupportsTeams,
  type MatchRound,
  type MatchSummary,
  type TeamResult,
  MIXED,
  MIXED_DESCRIPTION,
  MOVE_CONTROLS,
  SIZE_PREFS,
  HAND_PREFS,
  MIN_OPACITY,
  MAX_OPACITY,
  OPTION_GROUPS,
  PALETTE,
  ROUNDS_TO_WIN_OPTION,
  APP_VERSION,
  defaultOptions,
  describeOptions,
  describeSelection,
  findConflict,
  getLang,
  groupOf,
  isBindableCode,
  loc,
  normalizeSelection,
  optionSources,
  optionsFor,
  playerCountConflict,
  avatarModel,
  characterModel,
  characterModels,
  defaultLook,
  lookOf,
  randomLook,
  ROOM_CODE_LENGTH,
  sanitizeAvatar,
  sanitizeLooks,
  sanitizePassword,
  setLang,
  t,
  tr,
  type CatalogGame,
  type GameTag,
  type ControlAction,
  type GameSelection,
  type Guide,
  type CharacterModel,
  type CharacterSlot,
  type Looks,
  type MessageKey,
  tagsInUse,
  tagsOf,
  type MoveControl,
  type OptionDef,
  type OptionGroup,
  type OptionSource,
  type OptionValue,
  type Placement,
  type PlaylistEntry,
  type Presets,
  type ProfileRecord,
  type ProfileStats,
  type ShowPref,
  type VoteKind,
} from '../../../shared';
import { h } from './dom';
import { lobbyExtraRows, lobbyHostSlots, lobbyInfoSlots, lobbyRowSlots, pluginScreens, profileSectionSlots, renderPluginScreen } from '../plugins/features';
import { sfx } from '../audio/sfx';
import { consoleStatus, consoleToken, pairConsole } from '../consoleLink';
import { brandName, enabledCatalog, linkOrigin, isEntryEnabled, isSelectionEnabled, refreshDisabled, serverPlaylists, welcomeMessage } from '../catalogState';
import { ageOf, hasAnnouncements, maintenanceInfo } from '../maintenance';
import { parseLocation, profilePath, replacePath, roomPath } from '../route';
import { loadControls, resetControls, saveControls } from '../controls';
import { isTouchDevice, loadTouchPrefs, saveTouchPrefs } from '../touch-prefs';
import {
  applyProfileLang,
  applyRecoveryInput,
  cachedProfile,
  fetchProfile,
  isGuest,
  loadProfileKey,
  recoveryLink,
  saveProfile,
  setGuest,
  winRate,
} from '../profile';
import { qrSvg } from '../qr';
import { clearLastRoom, loadLastRoom } from '../reconnect';
import { cleanRoomCodeInput } from '../roomCode';
import { paintAvatar, paintCharacter } from './characterPreview';
import { ensureModel } from '../plugins/characters';
import { addPlaylist, addVariant, currentPresets, refreshPresets, removePreset, renamePreset, savePresets } from '../presets';
import { hex, session } from '../session';
import { currentInstallMode, onInstallChange, promptInstall } from '../install';
import { loadAccessPrefs, saveAccessPrefs } from '../access-prefs';
import { loadAudioPrefs, saveAudioPrefs } from '../audio-prefs';
import { qualityOf } from '../netquality';
import { loadEmoteKeys, saveEmoteKeys } from '../emote-keys';

type Attrs = Record<string, unknown>;

/** Chips of a game's tags, read only. */
function tagChips(tags: readonly GameTag[]): HTMLElement {
  const row = h('p', { class: 'tags' }, ...tags.map((x) => h('span', { class: 'tag' }, t(`tag.${x}` as MessageKey))));
  row.hidden = tags.length === 0;
  return row;
}

/**
 * Tag filter: one toggle button per tag in use, plus Clear. `selected` is updated in place and `onChange`
 * runs after every tap. Nothing is shown when the games carry no tags.
 */
function tagFilter(offered: readonly GameTag[], selected: Set<GameTag>, onChange: () => void): HTMLElement {
  const bar = h('div', { class: 'tag-filter', role: 'group', 'aria-label': t('tags.filter') });
  const paint = () => {
    const chips = offered.map((x) => {
      const on = selected.has(x);
      return h(
        'button',
        {
          class: on ? 'chip on' : 'chip',
          type: 'button',
          'aria-pressed': String(on),
          onClick: () => {
            if (on) selected.delete(x);
            else selected.add(x);
            paint();
            onChange();
          },
        },
        t(`tag.${x}` as MessageKey),
      );
    });
    if (selected.size > 0) {
      chips.push(
        h(
          'button',
          {
            class: 'chip clear',
            type: 'button',
            onClick: () => {
              selected.clear();
              paint();
              onChange();
            },
          },
          t('tags.clear'),
        ),
      );
    }
    bar.replaceChildren(...chips);
  };
  paint();
  bar.hidden = offered.length === 0;
  return bar;
}

/**
 * A Leave button. With `confirm`, the first tap asks "Tap again to leave" and the label goes back after a
 * few seconds, so a stray tap on a passed-around phone cannot drop the room.
 */
function leaveButton(label: string, onLeave: () => void, attrs: Attrs, confirm = true, confirmText = t('menu.leaveConfirm')): HTMLButtonElement {
  let armed: number | undefined;
  const btn = h('button', {
    ...attrs,
    onClick: () => {
      if (!confirm || armed !== undefined) {
        window.clearTimeout(armed);
        return onLeave();
      }
      btn.textContent = confirmText;
      armed = window.setTimeout(() => {
        armed = undefined;
        btn.textContent = label;
      }, 3000);
    },
  }, label);
  return btn;
}

// ---- how-to-play guide -------------------------------------------------------------------------

function guideBlock(guide: Guide | null, extraRules: string[] = [], open = false): HTMLElement {
  const body = h('div', { class: 'guide-body' });
  if (guide) body.append(h('h4', {}, t('guide.objective')), h('p', {}, loc(guide.objective)));
  const rules = guide ? guide.rules.map(loc) : [];
  body.append(h('h4', {}, t('guide.rules')), h('ul', {}, ...[...rules, ...extraRules].map((r) => h('li', {}, r))));
  if (guide?.items?.length) {
    body.append(h('h4', {}, t('guide.items')), h('ul', {}, ...guide.items.map((i) => h('li', {}, h('b', {}, `${loc(i.name)}: `), loc(i.description)))));
  }
  body.append(h('p', { class: 'hint' }, t('guide.controls')));
  return h('details', { class: 'guide', open }, h('summary', {}, t('guide.title')), body);
}

/** Guide of a game/variant choice (mixed, custom playlist, "all variants" or one variant). */
function guideFor(game: string, variant: string): HTMLElement {
  if (game === MIXED || game === CUSTOM) {
    const text = (k: MessageKey) => ({ en: t(k) });
    return guideBlock({
      objective: text('guide.mixed.objective'),
      rules: [text('guide.mixed.rule1'), text('guide.mixed.rule2'), text('guide.mixed.rule3')],
    });
  }
  const g = CATALOG.find((c) => c.id === game);
  if (!g) return guideBlock(null);
  const v = g.variants.find((x) => x.id === variant);
  if (v) return guideBlock(v.guide);
  return guideBlock(g.guide, g.variants.length > 0 ? [t('guide.all.rule1'), t('guide.all.rule2')] : []);
}

// ---- small shared controls ---------------------------------------------------------------------

function langSelect(onChange: () => void): HTMLSelectElement {
  const sel = h('select', { class: 'sel lang', 'data-fid': 'lang', 'aria-label': t('lang.label') }, ...LANGS.map((l) => h('option', { value: l }, `${LANG_FLAGS[l]} ${LANG_NAMES[l]}`)));
  sel.value = getLang();
  sel.addEventListener('change', () => {
    setLang(sel.value as typeof LANGS[number]);
    onChange();
  });
  return sel;
}

function guestToggle(): HTMLElement {
  const box = h('input', { type: 'checkbox', id: 'guest-mode' });
  box.checked = isGuest();
  box.addEventListener('change', () => setGuest(box.checked));
  return h('label', { class: 'sub', style: 'display:block;margin:8px 0' }, box, ' ', t('menu.guest'));
}

/** Pill with a status dot: how many players are connected to the server (polls /status while on screen). */
function presenceBadge(): HTMLElement {
  const el = h('span', { class: 'presence', role: 'status', 'data-state': 'off' }, t('profile.loading'));
  let first = true; // the first tick runs before the caller has inserted the badge
  const tick = () => {
    if (!el.isConnected && !first) return void clearInterval(timer); // removed, or never inserted
    first = false;
    if (document.visibilityState !== 'visible') return; // no polling in hidden tabs
    void fetch('/status?format=json', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ clients: number }>)
      .then((s) => {
        el.dataset.state = 'ok';
        el.textContent = t('presence.online', { n: s.clients });
      })
      .catch(() => {
        el.dataset.state = 'off';
        el.textContent = t('presence.offline');
      });
  };
  const timer = window.setInterval(tick, 5000);
  tick();
  return el;
}

function soundToggle(): HTMLElement {
  const btn = h('button', { class: 'btn alt small', 'data-fid': 'sound' });
  const paint = () => {
    const on = !sfx.isMuted();
    btn.textContent = t(on ? 'sound.on' : 'sound.off');
    btn.setAttribute('aria-pressed', String(on));
  };
  btn.addEventListener('click', () => {
    sfx.setMuted(!sfx.isMuted());
    paint();
  });
  paint();
  return btn;
}

// ---- remembered choices ------------------------------------------------------------------------

const NAME_KEY = 'party-game:name';
const nameStore = {
  get: (): string => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (n: string): void => {
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* private mode */
    }
  },
};

const OPTIONS_KEY = 'party-game:options:';

/** Advanced options the host last used for a game/variant. */
function loadOptions(game: string, variant: string): Record<string, OptionValue> {
  try {
    const raw = JSON.parse(localStorage.getItem(`${OPTIONS_KEY}${game}/${variant}`) ?? 'null');
    return normalizeSelection(game, variant, raw ?? {})?.options ?? {};
  } catch {
    return {};
  }
}

function saveOptions(game: string, variant: string, options: Record<string, OptionValue>): void {
  try {
    localStorage.setItem(`${OPTIONS_KEY}${game}/${variant}`, JSON.stringify(options));
  } catch {
    /* private mode */
  }
}

const SELECTION_KEY = 'party-game:selection';

function loadSelection(): GameSelection {
  try {
    const raw = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null');
    return normalizeSelection(raw?.game, raw?.variant, raw?.options) ?? { ...DEFAULT_SELECTION };
  } catch {
    return { ...DEFAULT_SELECTION };
  }
}

function saveSelection(sel: GameSelection): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
  } catch {
    /* private mode */
  }
}

/** "Game - Variant" for a saved preset or playlist entry. */
function entryName(e: Pick<GameSelection, 'game' | 'variant'>): string {
  const g = CATALOG.find((c) => c.id === e.game);
  const v = g?.variants.find((x) => x.id === e.variant);
  return g && v ? `${g.name} - ${v.name}` : (g?.name ?? e.game);
}

/** The non-default options of an entry as "Label: value | ...". */
function entryOptions(e: Pick<GameSelection, 'game' | 'variant' | 'options'>): string {
  return describeOptions({ game: e.game, variant: e.variant, options: e.options }).join(' | ');
}

// ---- advanced options --------------------------------------------------------------------------

function optionValueText(d: OptionDef, v: OptionValue): string {
  if (d.type === 'number') return v === 0 && d.zeroLabel ? tr(d.zeroLabel) : `${v}${d.unit ?? ''}`;
  return String(v);
}

/** One option as a labelled control; `source` adds a badge saying whether it is core or variant-only. */
function optionRow(d: OptionDef, values: Record<string, OptionValue>, onChange: () => void, source?: { kind: OptionSource; variant: string }): HTMLElement {
  const row = h('div', { class: 'opt' });
  const inputId = `opt-${d.id}`;
  const badge = source ? h('span', { class: `src${source.kind === 'variant' ? ' variant' : ''}` }, source.kind === 'core' ? t('opt.source.core') : source.variant) : null;
  const val = h('b', { class: 'val' }, optionValueText(d, values[d.id] as OptionValue));
  const label = h('label', { htmlFor: inputId }, h('span', {}, tr(d.label), badge), val);
  row.append(label);
  if (d.type === 'number') {
    const input = h('input', { id: inputId, type: 'range', min: String(d.min), max: String(d.max), step: String(d.step ?? 1), value: String(values[d.id]) });
    input.addEventListener('input', () => {
      values[d.id] = Number(input.value);
      val.textContent = optionValueText(d, values[d.id] as OptionValue);
      onChange();
    });
    row.append(input);
  } else if (d.type === 'boolean') {
    const input = h('input', { id: inputId, type: 'checkbox', checked: values[d.id] === true });
    const paint = () => (val.textContent = input.checked ? t('opt.on') : t('opt.off'));
    input.addEventListener('change', () => {
      values[d.id] = input.checked;
      paint();
      onChange();
    });
    paint();
    row.append(input);
  } else {
    const input = h('select', { class: 'sel', id: inputId }, ...(d.choices ?? []).map((c) => h('option', { value: c.value }, tr(c.label))));
    input.value = String(values[d.id]);
    const paint = () => (val.textContent = tr(d.choices?.find((c) => c.value === input.value)?.label ?? input.value));
    input.addEventListener('change', () => {
      values[d.id] = input.value;
      paint();
      onChange();
    });
    paint();
    row.append(input);
  }
  row.append(h('p', { class: 'hint' }, tr(d.description)));
  return row;
}

/** Options as a flat list (playlist rounds). */
function renderOptions(defs: OptionDef[], values: Record<string, OptionValue>, onChange: () => void): HTMLElement[] {
  return defs.map((d) => optionRow(d, values, onChange));
}

/** Options split into the standard sections; core/variant badges only when both kinds are present. */
function renderGroupedOptions(defs: OptionDef[], values: Record<string, OptionValue>, onChange: () => void, sources: Record<string, OptionSource>, variantName: string): HTMLElement[] {
  const mixed = new Set(defs.map((d) => sources[d.id] ?? 'core')).size > 1;
  const out: HTMLElement[] = [];
  if (mixed) out.push(h('p', { class: 'hint' }, t('opt.source.hint')));
  const byGroup = new Map<OptionGroup, OptionDef[]>();
  for (const d of defs) {
    const g = groupOf(d);
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  for (const g of OPTION_GROUPS) {
    const list = byGroup.get(g);
    if (!list?.length) continue;
    out.push(
      h(
        'details',
        { class: 'opt-group', open: g === 'match' },
        h('summary', {}, t(`opt.group.${g}` as MessageKey)),
        ...list.map((d) => optionRow(d, values, onChange, mixed ? { kind: sources[d.id] ?? 'core', variant: variantName } : undefined)),
      ),
    );
  }
  return out;
}

/** Only the values that differ from the defaults are sent / remembered. */
function changedOptions(defs: OptionDef[], values: Record<string, OptionValue>): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {};
  for (const d of defs) if (values[d.id] !== d.default) out[d.id] = values[d.id] as OptionValue;
  return out;
}

// ---- keyboard / touch controls editors ---------------------------------------------------------

export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return arrows[code] ?? code.replace(/^Numpad/, 'Num ');
}

/** Rebind the game keys: change, add or remove up to MAX_KEYS_PER_ACTION keys per action. */
function controlsEditor(): HTMLElement {
  const root = h('div', { class: 'controls-editor' });
  let controls = loadControls();
  let capturing: { action: ControlAction; index: number } | null = null;
  let note = '';

  const savedNote = () => t(isGuest() ? 'controls.savedTab' : cachedProfile() ? 'controls.savedProfile' : 'controls.savedBrowser');
  const commit = async (next: typeof controls) => {
    controls = next;
    note = savedNote();
    render();
    controls = await saveControls(next);
    render();
  };

  const stop = () => {
    capturing = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
  };
  const onBlur = () => {
    stop();
    note = '';
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!capturing) return;
    // The panel was swapped out mid-capture: release the keyboard instead of swallowing it.
    if (!root.isConnected) return stop();
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      stop();
      note = '';
      return render();
    }
    if (!isBindableCode(e.code)) {
      note = t('controls.notAllowed');
      return render();
    }
    const { action, index } = capturing;
    const clash = findConflict(controls, action, e.code);
    if (clash) {
      note = t('controls.conflict', { action: t(`controls.${clash}` as MessageKey) });
      return render();
    }
    const keys = [...controls[action]];
    if (index >= keys.length) keys.push(e.code);
    else keys[index] = e.code;
    stop();
    void commit({ ...controls, [action]: [...new Set(keys)] });
  };
  const capture = (action: ControlAction, index: number) => {
    stop();
    capturing = { action, index };
    note = t('controls.press');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    render();
  };

  function render(): void {
    const rows = CONTROL_ACTIONS.map((action) => {
      const keys = controls[action];
      const slots = keys.map((code, i) =>
        h(
          'span',
          { class: 'keyslot' },
          h(
            'button',
            {
              class: 'btn small' + (capturing?.action === action && capturing.index === i ? '' : ' alt'),
              title: t('controls.change'),
              'aria-label': `${t(`controls.${action}` as MessageKey)}: ${keyLabel(code)} - ${t('controls.change')}`,
              onClick: () => capture(action, i),
            },
            keyLabel(code),
          ),
          keys.length > 1
            ? h('button', { class: 'btn small alt icon', title: t('controls.remove'), 'aria-label': t('controls.remove'), onClick: () => void commit({ ...controls, [action]: keys.filter((_, j) => j !== i) }) }, '✕')
            : null,
        ),
      );
      return h(
        'div',
        { class: 'controls-row' },
        h('span', { class: 'controls-name' }, t(`controls.${action}` as MessageKey)),
        ...slots,
        keys.length < MAX_KEYS_PER_ACTION ? h('button', { class: 'btn small alt', onClick: () => capture(action, keys.length) }, t('controls.add')) : null,
      );
    });
    root.replaceChildren(
      ...rows,
      h('button', { class: 'btn small alt', onClick: () => void resetControls().then((c) => ((controls = c), (note = savedNote()), render())) }, t('controls.reset')),
      ...(note ? [h('p', { class: 'hint', role: 'status' }, note)] : []),
      h('p', { class: 'hint' }, t('controls.hint')),
    );
  }
  render();
  return root;
}

/** Rebind the emote bar: the open/close key and one key per reaction (single keys, this browser only). */
function emoteKeysEditor(): HTMLElement {
  const root = h('div', { class: 'controls-editor' });
  let keys = loadEmoteKeys();
  /** -1 = the open/close key, otherwise the reaction index */
  let capturing: number | null = null;
  let note = '';

  const savedNote = () => t(isGuest() ? 'controls.savedTab' : cachedProfile() ? 'controls.savedProfile' : 'controls.savedBrowser');
  const commit = async (next: typeof keys) => {
    keys = next;
    note = savedNote();
    render();
    keys = await saveEmoteKeys(next);
    render();
  };

  const stop = () => {
    capturing = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
  };
  const onBlur = () => {
    stop();
    note = '';
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    if (capturing === null) return;
    if (!root.isConnected) return stop();
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      stop();
      note = '';
      return render();
    }
    if (!isBindableCode(e.code)) {
      note = t('controls.notAllowed');
      return render();
    }
    const own = capturing === -1 ? keys.toggle : keys.emotes[capturing];
    const gameClash = CONTROL_ACTIONS.find((a) => loadControls()[a].includes(e.code));
    if (gameClash) {
      note = t('controls.conflict', { action: t(`controls.${gameClash}` as MessageKey) });
      return render();
    }
    const other = e.code === keys.toggle ? -1 : keys.emotes.indexOf(e.code);
    if (e.code !== own && (e.code === keys.toggle || other >= 0)) {
      note = t('controls.conflict', { action: other === -1 ? t('emote.toggle') : `${EMOTES[other]} ${t(`emote.${other}` as MessageKey)}` });
      return render();
    }
    const next = capturing === -1 ? { ...keys, toggle: e.code } : { ...keys, emotes: keys.emotes.map((c, i) => (i === capturing ? e.code : c)) };
    stop();
    void commit(next);
  };
  const capture = (slot: number) => {
    stop();
    capturing = slot;
    note = t('controls.press');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    render();
  };

  function render(): void {
    const row = (slot: number, name: string, code: string) =>
      h(
        'div',
        { class: 'controls-row' },
        h('span', { class: 'controls-name' }, name),
        h(
          'button',
          {
            class: 'btn small' + (capturing === slot ? '' : ' alt'),
            title: t('controls.change'),
            'aria-label': `${name}: ${keyLabel(code)} - ${t('controls.change')}`,
            onClick: () => capture(slot),
          },
          keyLabel(code),
        ),
      );
    root.replaceChildren(
      h('h3', {}, t('emote.title')),
      row(-1, t('emote.toggle'), keys.toggle),
      ...EMOTES.map((icon, i) => row(i, `${icon} ${t(`emote.${i}` as MessageKey)}`, keys.emotes[i]!)),
      h('button', { class: 'btn small alt', onClick: () => void commit(defaultEmoteKeys()) }, t('controls.reset')),
      ...(note ? [h('p', { class: 'hint', role: 'status' }, note)] : []),
      h('p', { class: 'hint' }, t('emote.keysHint')),
    );
  }
  render();
  return root;
}

/** Master / effects / music volume sliders (applied live while dragging, saved on release). */
function volumeEditor(): HTMLElement {
  const root = h('div', { class: 'controls-editor' });
  let prefs = loadAudioPrefs();
  let note = '';
  const noteEl = h('p', { class: 'hint', role: 'status' });
  const row = (key: 'master' | 'sfx' | 'music', label: string) => {
    const out = h('span', { class: 'slot-val' }, `${prefs[key]}%`);
    const input = h('input', {
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      value: String(prefs[key]),
      'aria-label': label,
      onInput: () => {
        prefs = { ...prefs, [key]: Number(input.value) };
        out.textContent = `${prefs[key]}%`;
        sfx.setVolumes(prefs); // hear it while dragging
      },
      onChange: () => {
        void saveAudioPrefs(prefs).then((saved) => {
          prefs = saved;
          sfx.play('click');
        });
        note = t(isGuest() ? 'controls.savedTab' : cachedProfile() ? 'controls.savedProfile' : 'controls.savedBrowser');
        noteEl.textContent = note;
      },
    });
    return h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, label), input, out);
  };
  root.replaceChildren(
    h('h3', {}, t('volume.title')),
    row('master', t('volume.master')),
    row('sfx', t('volume.sfx')),
    row('music', t('volume.music')),
    noteEl,
  );
  return root;
}

/** Accessibility display options: colour-blind palette and player markers. */
function accessEditor(): HTMLElement {
  const root = h('div', { class: 'controls-editor' });
  let prefs = loadAccessPrefs();
  let note = '';
  const update = async (next: typeof prefs) => {
    prefs = next;
    note = t(isGuest() ? 'controls.savedTab' : cachedProfile() ? 'controls.savedProfile' : 'controls.savedBrowser');
    render();
    prefs = await saveAccessPrefs(next);
    render();
  };
  function render(): void {
    const box = (key: 'colorblind' | 'markers', label: string) =>
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: prefs[key], onChange: (e: Event) => void update({ ...prefs, [key]: (e.target as HTMLInputElement).checked }) }),
        ` ${label}`,
      );
    root.replaceChildren(
      h('h3', {}, t('access.title')),
      box('colorblind', t('access.colorblind')),
      box('markers', t('access.markers')),
      h(
        'label',
        { class: 'check' },
        `${t('access.motion')} `,
        (() => {
          const sel = h(
            'select',
            { class: 'sel', 'aria-label': t('access.motion'), onChange: () => void update({ ...prefs, motion: sel.value as typeof prefs.motion }) },
            ...MOTION_LEVELS.map((m) => h('option', { value: m }, t(`access.motion.${m}` as MessageKey))),
          );
          sel.value = prefs.motion;
          return sel;
        })(),
      ),
      ...(note ? [h('p', { class: 'hint', role: 'status' }, note)] : []),
      h('p', { class: 'hint' }, t('access.hint')),
    );
  }
  render();
  return root;
}

/** On-screen control preferences: show them or not, joystick or cross, globally or per game. */
function touchEditor(): HTMLElement {
  const root = h('div', { class: 'controls-editor' });
  let prefs = loadTouchPrefs();
  const forced = isTouchDevice();

  const update = async (next: typeof prefs) => {
    prefs = next;
    prefs = await saveTouchPrefs(next);
    render();
  };

  function render(): void {
    const show = h('select', { class: 'sel', 'aria-label': t('touch.show'), disabled: forced },
      ...(['auto', 'on', 'off'] as ShowPref[]).map((v) => h('option', { value: v }, t(`touch.show.${v}` as MessageKey))));
    show.value = prefs.show;
    show.addEventListener('change', () => void update({ ...prefs, show: show.value as ShowPref }));

    const move = h('select', { class: 'sel', 'aria-label': t('touch.move') },
      h('option', { value: 'auto' }, t('touch.move.auto')),
      ...MOVE_CONTROLS.map((v) => h('option', { value: v }, t(`touch.move.${v}` as MessageKey))));
    move.value = prefs.move;
    move.addEventListener('change', () => void update({ ...prefs, move: move.value as typeof prefs.move }));

    const choice = <T extends string>(key: 'size' | 'hand', values: readonly T[]) => {
      const sel = h('select', { class: 'sel', 'aria-label': t(`touch.${key}` as MessageKey) },
        ...values.map((v) => h('option', { value: v }, t(`touch.${key}.${v}` as MessageKey))));
      sel.value = prefs[key];
      sel.addEventListener('change', () => void update({ ...prefs, [key]: sel.value }));
      return sel;
    };
    const opacity = h('input', { type: 'range', min: String(MIN_OPACITY), max: String(MAX_OPACITY), step: '10',
      'aria-label': t('touch.opacity') });
    opacity.value = String(prefs.opacity);
    opacity.addEventListener('change', () => void update({ ...prefs, opacity: Number(opacity.value) }));
    const haptics = h('input', { type: 'checkbox', 'aria-label': t('touch.haptics') });
    haptics.checked = prefs.haptics;
    haptics.addEventListener('change', () => void update({ ...prefs, haptics: haptics.checked }));
    const floating = h('input', { type: 'checkbox', 'aria-label': t('touch.floating') });
    floating.checked = prefs.floating;
    floating.addEventListener('change', () => void update({ ...prefs, floating: floating.checked }));

    const perGame = enabledCatalog().map((g) => {
      const sel = h('select', { class: 'sel', 'aria-label': `${g.name}: ${t('touch.move')}` },
        h('option', { value: '' }, t('touch.move.auto')),
        ...MOVE_CONTROLS.map((v) => h('option', { value: v }, t(`touch.move.${v}` as MessageKey))));
      sel.value = prefs.perGame?.[g.id] ?? '';
      sel.addEventListener('change', () => {
        const next = { ...(prefs.perGame ?? {}) } as Record<string, MoveControl>;
        if (sel.value) next[g.id] = sel.value as MoveControl;
        else delete next[g.id];
        void update({ ...prefs, perGame: Object.keys(next).length ? next : undefined });
      });
      return h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, g.name), sel);
    });

    root.replaceChildren(
      h('h2', {}, t('touch.title')),
      h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, t('touch.show')), show),
      ...(forced ? [h('p', { class: 'hint' }, t('touch.forced'))] : []),
      h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, t('touch.move')), move),
      h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, t('touch.size')), choice('size', SIZE_PREFS)),
      h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, t('touch.opacity')), opacity),
      h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, t('touch.hand')), choice('hand', HAND_PREFS)),
      h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, t('touch.haptics')), haptics),
      h('div', { class: 'controls-row' }, h('span', { class: 'controls-name' }, t('touch.floating')), floating),
      h('h2', {}, t('touch.perGame')),
      ...perGame,
      ...enabledCatalog().filter((g) => g.touchHint).map((g) => h('p', { class: 'hint' }, loc(g.touchHint!))),
    );
  }
  render();
  return root;
}

// ---- UI ----------------------------------------------------------------------------------------

export interface UIHandlers {
  onCreate(name: string, selection: GameSelection, password?: string, isPublic?: boolean): void;
  onJoin(name: string, code: string): void;
  onReady(ready: boolean): void;
  onStart(force?: boolean): void;
  onNext(): void;
  onJoinLink(name: string, code: string, password?: string): void;
  onWatch(code: string, password?: string): void;
  /** console mode: watch the TV's room as its host (the phone is paired) */
  onConsoleControl(code: string, token: string): void;
  onPromote(): void;
  /** a player gives up the seat and watches */
  onLeaveSeat(): void;
  /** host: move a user between the player seats and the spectators */
  onSetRole(id: string, spectator: boolean): void;
  onKick(id: string): void;
  onMakeHost(id: string): void;
  onResetName(id: string): void;
  /** tell the operator about another player (silent to the room) */
  onReport(id: string): void;
  onSettings(s: { locked?: boolean; maxPlayers?: number; teams?: boolean; password?: string | null; lateJoin?: boolean; catchUp?: number }): void;
  /** move to a team (or, as host, move player `id`) */
  onSetTeam(team: number, id?: string): void;
  onSetSelection(selection: GameSelection): void;
  onLeave(): void;
  onCopy(spectator: boolean): void;
  onVoteStart(kind: VoteKind): void;
  /** host only: everyone back to the lobby now, no vote */
  onBackToLobby(): void;
  onVote(yes: boolean): void;
  onMenuClose(): void;
  /** Last round-trip time to the server in ms (0 = unknown). */
  rtt(): number;
  /** The first-run how-to-play card was dismissed. */
  onHowToClose(): void;
  /** The player left (`true`) or came back to (`false`) the room view while staying connected. */
  onAway(away: boolean): void;
}

/** Host-driven "change game" mode of the create/playlist panels while a room is open. */
interface ChangeMode {
  onConfirm(sel: GameSelection): void;
  onBack(): void;
  /** Only the current game's options can be edited (game and variant are locked). */
  optionsOnly?: boolean;
}

const VOTE_TEXT = {
  round: 'vote.wantsRound',
  match: 'vote.wantsMatch',
  again: 'vote.wantsAgain',
  change: 'vote.wantsChange',
} as const;

/** Menu / lobby / results are plain DOM: accessible, crisp text, cheap on phones. */
export class UI {
  private root = document.getElementById('ui')!;
  private awayEl = document.getElementById('away')!;
  private badgeEl = document.getElementById('room-badge')!;
  private navEl = document.getElementById('topnav')!;
  private voteTimer = 0;
  private createPassword = '';
  private createPublic = false;
  private kickArmed = '';
  private hostPanelOpen = false;
  private passwordDraft = '';
  /** A player in a room is looking at menu/profile/rooms/status; the room view stays rendered underneath. */
  private away = false;
  /** Lobby: whether the invite QR is shown (kept across the frequent lobby re-renders); unset = shown on a watch screen only. */
  private lobbyQr: boolean | undefined;

  constructor(private readonly handlers: UIHandlers) {
    this.toastEl(); // live region must exist before its first message to be announced reliably
    this.badgeEl.addEventListener('click', () => this.returnToRoom());
    this.navEl.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a || !session.code) return; // outside a room the links are plain navigations
      e.preventDefault();
      if (a.id === 'nav-rooms') this.showRooms();
      else if (a.id === 'nav-status') this.showStatus();
      else if (a.dataset.plugin) this.showPluginScreen(a.dataset.plugin);
      else if (a.id === 'nav-profile') this.showProfile();
      else this.showMenu();
    });
  }

  /** Banner ids the player closed (drain notice: 'drain'); the Announcements screen still lists them. */
  private dismissedBanners = new Set<string>();

  private maintEl(): HTMLElement {
    let el = document.getElementById('maint');
    if (!el) {
      el = document.createElement('div');
      el.id = 'maint';
      el.setAttribute('role', 'status');
      el.hidden = true;
      document.body.append(el);
    }
    return el;
  }

  /** What is pinned right now: the drain notice, then the pinned announcements. */
  private pinnedTexts(): { id: string; text: string }[] {
    const m = maintenanceInfo();
    return [...(m.draining ? [{ id: 'drain', text: m.message || t('maintenance.draining') }] : []), ...m.banners.map((b) => ({ id: b.id, text: b.message }))];
  }

  /** The server's drain/announcement state changed: update the banner and the menu buttons in place. */
  refreshMaintenance(): void {
    if (!maintenanceInfo().draining) this.dismissedBanners.delete('drain');
    const items = this.pinnedTexts().filter((i) => !this.dismissedBanners.has(i.id));
    const el = this.maintEl();
    el.replaceChildren();
    el.hidden = items.length === 0;
    if (items.length > 0) {
      el.append(
        h('button', { class: 'maint-text', onClick: () => this.showAnnouncements() }, items[0]!.text + (items.length > 1 ? ` ${t('maintenance.more', { n: items.length - 1 })}` : '')),
        h('button', { class: 'maint-x', 'aria-label': t('maintenance.dismiss'), onClick: () => { for (const i of items) this.dismissedBanners.add(i.id); this.refreshMaintenance(); } }, '×'),
      );
    }
    for (const slot of document.querySelectorAll('.announce-slot')) slot.replaceChildren(...this.announceButton());
  }

  private announceButton(): HTMLElement[] {
    return hasAnnouncements() ? [h('button', { class: 'btn alt', onClick: () => this.showAnnouncements() }, t('menu.announcements'))] : [];
  }

  private announceSlot(): HTMLElement {
    return h('div', { class: 'announce-slot' }, ...this.announceButton());
  }

  /** Pinned announcements (and the drain notice), then the latest ones to re-read. */
  showAnnouncements(): void {
    const m = maintenanceInfo();
    const pinned = this.pinnedTexts();
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, t('announce.title')),
        pinned.length > 0 ? h('h3', {}, t('announce.pinned')) : null,
        pinned.length > 0 ? h('ul', { class: 'announce-list' }, ...pinned.map((p) => h('li', {}, p.text))) : null,
        m.recent.length > 0 ? h('h3', {}, t('announce.recent')) : null,
        m.recent.length > 0
          ? h(
              'ul',
              { class: 'announce-list' },
              ...m.recent.map((r) => {
                const age = ageOf(r.at);
                return h('li', {}, r.message, h('small', {}, t(age.key, { n: age.n })));
              }),
            )
          : null,
        pinned.length === 0 && m.recent.length === 0 ? h('p', { class: 'sub' }, t('announce.empty')) : null,
        h('button', { class: 'btn alt', onClick: () => this.showMenu() }, t('profile.back')),
      ),
    );
  }

  private toastEl(): HTMLElement {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.append(el);
    }
    return el;
  }

  // ---- away views: navigate while staying in the room ----------------------------------------

  isAway(): boolean {
    return this.away;
  }

  /** Back from an away view: the room view was kept up to date underneath, the app re-renders the phase. */
  returnToRoom(): void {
    if (!this.away) return;
    this.clearAway();
    this.navEl.hidden = true;
    this.handlers.onAway(false);
  }

  private clearAway(): void {
    this.away = false;
    this.awayEl.replaceChildren();
    this.awayEl.hidden = true;
    this.root.hidden = false;
    this.badgeEl.hidden = true;
  }

  /** Away views render over the (hidden) room view instead of replacing it. */
  private showAway(panel: HTMLElement, focus = true): void {
    const was = this.away;
    this.away = true;
    this.root.hidden = true;
    this.badgeEl.textContent = t('room.badge', { code: session.code });
    this.badgeEl.hidden = false;
    this.awayEl.hidden = false;
    this.awayEl.replaceChildren(panel);
    this.dialogize(panel);
    this.showNav();
    if (!was) this.handlers.onAway(true);
    if (focus) panel.querySelector<HTMLElement>('button.btn')?.focus({ preventScroll: true });
  }

  /** Panels of the menu/profile family: over the room when in one, else the normal panel swap. */
  private paint(panel: HTMLElement, focus = true): void {
    if (session.code) this.showAway(panel, focus);
    else {
      this.show(panel, focus);
      this.showNav();
    }
  }

  private dialogize(panel: HTMLElement): void {
    const heading = panel.querySelector<HTMLElement>('h1, h2');
    panel.setAttribute('role', 'dialog');
    if (heading) {
      heading.id ||= 'panel-title';
      panel.setAttribute('aria-labelledby', heading.id);
    } else panel.setAttribute('aria-label', brandName());
  }

  /** Menu while in a room: no create/join, just the way back (or out). */
  private showRoomMenu(): void {
    this.showAway(
      h(
        'div',
        { class: 'panel' },
        h('h1', { 'data-brand': 'name' }, brandName()),
        h('p', { class: 'sub' }, t('room.badge', { code: session.code })),
        h('button', { class: 'btn alt', onClick: () => this.showProfile() }, t('menu.profile')),
        this.announceSlot(),
        h('button', { class: 'btn alt', onClick: () => this.showSettings('menu') }, t('menu.settings')),
        this.leaveButton('btn alt'),
      ),
    );
  }

  /** Live rooms list, read from the same JSON the /rooms page uses (the socket stays open). */
  showRooms(): void {
    const body = h('div', {}, h('p', { class: 'sub' }, t('profile.loading')));
    const panel = h('div', { class: 'panel' }, h('h2', {}, t('rooms.title')), presenceBadge(), body);
    this.paint(panel);
    interface Row { code: string; game: string; status: string; locked: boolean; players: number; maxPlayers: number }
    void fetch('/rooms?format=json', { cache: 'no-store' })
      .then((r) => r.json() as Promise<Row[]>)
      .then((list) => {
        if (!panel.isConnected) return;
        if (!list.length) return body.replaceChildren(h('p', { class: 'sub' }, t('rooms.none')));
        body.replaceChildren(
          h(
            'table',
            { class: 'mini' },
            ...list.map((r) =>
              h(
                'tr',
                {},
                h('td', {}, r.code),
                h('td', {}, r.game),
                h('td', {}, r.status === 'open' ? t('rooms.open') : r.locked ? t('rooms.locked') : t('rooms.playing')),
                h('td', {}, `${r.players}/${r.maxPlayers}`),
              ),
            ),
          ),
        );
      })
      .catch(() => panel.isConnected && body.replaceChildren(h('p', { class: 'err' }, t('status.unreachable'))));
  }

  /** A page a plugin draws (like the leaderboard), with the app's back button and online pill available to it. */
  showPluginScreen(id: string): void {
    const def = pluginScreens().find((x) => x.id === id);
    const panel = def
      ? renderPluginScreen(id, {
          avatar: (player, color, size) => {
            const c = h('canvas', { class: 'lb-avatar', width: size, height: size, 'aria-hidden': 'true' });
            c.style.width = c.style.height = `${size}px`;
            paintAvatar(c, sanitizeLooks(player.looks), sanitizeAvatar(player.avatar), color);
            return c;
          },
          games: () => CATALOG.map((g) => ({ id: g.id, name: g.name })),
          presence: presenceBadge,
          back: () => this.showMenu(),
        })
      : null;
    if (!def || !panel) return this.showMenu();
    if (!session.code) replacePath(def.path);
    this.paint(panel);
  }

  showStatus(): void {
    const body = h('div', {}, h('p', { class: 'sub' }, t('profile.loading')));
    const panel = h('div', { class: 'panel' }, h('h2', {}, t('status.title')), body);
    this.paint(panel);
    void fetch('/status?format=json', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ version: string; rooms: number; maxRooms: number; clients: number }>)
      .then((s) => {
        if (!panel.isConnected) return;
        body.replaceChildren(
          h(
            'table',
            { class: 'mini' },
            h('tr', {}, h('td', {}, t('status.rooms')), h('td', {}, `${s.rooms}/${s.maxRooms}`)),
            h('tr', {}, h('td', {}, t('status.players')), h('td', {}, String(s.clients))),
            h('tr', {}, h('td', {}, t('status.version')), h('td', {}, `v${s.version}`)),
          ),
        );
      })
      .catch(() => panel.isConnected && body.replaceChildren(h('p', { class: 'err' }, t('status.unreachable'))));
  }

  // ---- panel plumbing ------------------------------------------------------------------------

  hide(): void {
    if (!session.code && this.away) this.clearAway();
    if (!this.away) this.navEl.hidden = true;
    this.root.replaceChildren();
    this.root.classList.remove('over');
  }

  /**
   * Swap the panel. It becomes a dialog named by its heading; focus returns to the same
   * `data-fid` control (e.g. the language select) if that had it, else moves to the
   * primary control. `focus: false` leaves focus alone (lobby re-renders restore it themselves).
   * While an away view is open the room panel is only updated underneath (hidden), never shown.
   */
  private show(panel: HTMLElement, focus = true): void {
    if (!session.code && this.away) this.clearAway();
    const hadFid = this.root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.fid : undefined;
    this.root.classList.remove('over');
    if (!this.away) this.navEl.hidden = true;
    this.root.replaceChildren(panel);
    this.dialogize(panel);
    if (!focus || this.away) return;
    const target =
      (hadFid && panel.querySelector<HTMLElement>(`[data-fid="${hadFid}"]`)) ||
      panel.querySelector<HTMLElement>('input, button.btn:not(.alt):not(:disabled)') ||
      panel.querySelector<HTMLElement>('button.btn:not(:disabled)');
    if (target) target.focus({ preventScroll: true });
    else {
      panel.tabIndex = -1;
      panel.focus({ preventScroll: true });
    }
  }

  private showNav(): void {
    for (const id of ['play', 'rooms', 'status', 'profile']) {
      document.getElementById(`nav-${id}`)!.textContent = t(`nav.${id}` as MessageKey);
    }
    // the pages plugins draw, before Profile
    for (const old of this.navEl.querySelectorAll('a[data-plugin]')) old.remove();
    const profile = document.getElementById('nav-profile')!;
    for (const sc of pluginScreens()) profile.before(h('a', { id: `nav-plugin-${sc.id}`, href: sc.path, 'data-plugin': sc.id }, sc.navLabel));
    this.navEl.hidden = false;
  }

  /** Brand text changed on the server: update the open panel in place. */
  refreshBrand(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-brand]')) {
      el.textContent = el.dataset.brand === 'name' ? brandName() : welcomeMessage() || t('menu.tagline');
    }
  }

  /** Screen-reader announcement (visually hidden live region); clears first so repeated text is re-read. */
  announce(text: string): void {
    const el = document.getElementById('sr-live');
    if (!el) return;
    el.textContent = '';
    window.setTimeout(() => (el.textContent = text), 50);
  }

  toast(text: string): void {
    const el = this.toastEl();
    el.textContent = text;
    el.classList.add('show');
    const timer = el as HTMLElement & { _t?: number };
    window.clearTimeout(timer._t);
    timer._t = window.setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ---- in-game menu and restart votes --------------------------------------------------------

  /** In-game menu: resume, restart (by vote) or leave. Closed with `hide()` or Resume. */
  /** The room's Leave button: the host, with others in the room, has to confirm (leaving may close or hand off the room). */
  private leaveButton(cls: string, attrs: Attrs = {}): HTMLButtonElement {
    const confirm = session.isHost && session.players.length > 1;
    return leaveButton(t('lobby.leave'), () => this.handlers.onLeave(), { class: cls, ...attrs }, confirm);
  }

  showGameMenu(): void {
    const playing = session.phase === 'countdown' || session.phase === 'playing';
    const voteBusy = session.vote !== null;
    const canVote = !session.spectator && !voteBusy;
    const leave = leaveButton(t('menu.leave'), () => this.handlers.onLeave(), { class: 'btn alt' });
    const start = (kind: VoteKind) => () => {
      this.handlers.onVoteStart(kind);
      this.handlers.onMenuClose();
    };
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, t('menu.menu')),
        h('button', { class: 'btn', onClick: () => this.handlers.onMenuClose() }, t('menu.resume')),
        session.spectator ? null : h('button', { class: 'btn', disabled: !(canVote && playing), onClick: start('round') }, t('menu.restartRound')),
        session.spectator ? null : h('button', { class: 'btn', disabled: !canVote, onClick: start('match') }, t('menu.restartMatch')),
        this.openGuide(),
        session.isHost
          ? leaveButton(t('menu.backToLobby'), () => { this.handlers.onBackToLobby(); this.handlers.onMenuClose(); }, { class: 'btn alt', 'data-fid': 'back-to-lobby' }, true, t('menu.backToLobbyConfirm'))
          : null,
        h('button', { class: 'btn alt', onClick: () => this.showSettings('game') }, t('menu.settings')),
        leave,
        voteBusy ? h('p', { class: 'menu-note' }, t('menu.voteBusy')) : null,
        session.spectator ? null : h('p', { class: 'menu-note' }, t('menu.majority')),
      ),
    );
    this.root.classList.add('over');
  }

  /** The guide of the round being played, expanded. */
  private openGuide(): HTMLElement {
    const guide = guideFor(...this.playingChoice()) as HTMLDetailsElement;
    guide.open = true;
    return guide;
  }

  /** First-run card over the countdown: the round's objective, rules and items. Dismissed with "Got it". */
  showHowTo(): void {
    this.show(
      h(
        'div',
        { class: 'panel' },
        this.openGuide(),
        h('button', { class: 'btn', 'data-fid': 'howto-ok', onClick: () => this.handlers.onHowToClose() }, t('howto.gotIt')),
      ),
    );
    this.root.classList.add('over');
  }

  /** Game/variant of the round being played (for its guide), else the lobby selection. */
  private playingChoice(): [string, string] {
    for (const g of CATALOG) {
      const v = g.variants.find((x) => x.id === session.playingId);
      if (v) return [g.id, v.id];
      if (g.variants.length === 0 && g.id === session.playingId) return [g.id, ALL_VARIANTS];
    }
    return [session.selection.game, session.selection.variant];
  }

  /** Vote banner, rebuilt from `session.vote`/`voteEndsAt` (the countdown keeps running). */
  renderVote(): void {
    const el = document.getElementById('vote')!;
    window.clearInterval(this.voteTimer);
    const v = session.vote;
    if (!v) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    const mine = v.yes.includes(session.myId) ? 'yes' : v.no.includes(session.myId) ? 'no' : '';
    const meta = h('div', { class: 'meta', 'aria-hidden': 'true' });
    const tick = () => {
      const left = Math.max(0, Math.ceil((session.voteEndsAt - performance.now()) / 1000));
      meta.textContent = t('vote.tally', { yes: v.yes.length, no: v.no.length, needed: v.needed, left });
    };
    const parts: HTMLElement[] = [h('p', {}, t(VOTE_TEXT[v.kind], { name: v.by })), meta];
    if (!session.spectator) {
      parts.push(
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn small', disabled: mine === 'yes', onClick: () => this.handlers.onVote(true) }, t(mine === 'yes' ? 'vote.votedYes' : 'vote.yes')),
          h('button', { class: 'btn alt small', disabled: mine === 'no', onClick: () => this.handlers.onVote(false) }, t(mine === 'no' ? 'vote.votedNo' : 'vote.no')),
        ),
      );
    }
    el.replaceChildren(...parts);
    el.hidden = false;
    tick();
    this.voteTimer = window.setInterval(tick, 250);
  }

  // ---- join link and main menu ---------------------------------------------------------------

  /** Console mode: pair this phone with the TV's PIN, then host the TV's room or open the admin page. */
  showConsole(message = ''): void {
    const token = consoleToken.get();
    if (!token) return this.showConsolePair(message);
    const panel = h('div', { class: 'panel' }, h('h1', {}, t('console.title')), h('p', { class: 'sub' }, t('console.checking')));
    this.show(panel);
    void consoleStatus(token).then((st) => {
      if (st.state === 'unpaired') {
        consoleToken.clear();
        return this.showConsolePair(t('console.unpaired'));
      }
      if (st.state === 'off') return this.showConsolePair(t('console.off'));
      if (st.state === 'net') return this.showConsolePair(t('conn.unreachable'));
      this.show(
        h(
          'div',
          { class: 'panel' },
          h('h1', {}, t('console.title')),
          h('p', { class: 'sub' }, st.roomCode ? t('console.paired', { code: st.roomCode }) : t('console.noRoom')),
          h('button', { class: 'btn', disabled: !st.roomCode, onClick: () => this.handlers.onConsoleControl(st.roomCode, token) }, t('console.control')),
          h('a', { class: 'btn alt', href: `/admin#token=${token}` }, t('console.admin')),
          h('button', { class: 'btn alt small', onClick: () => { consoleToken.clear(); this.showConsolePair(); } }, t('console.forget')),
          h('button', { class: 'btn alt small', onClick: () => this.showMenu() }, t('link.mainMenu')),
        ),
      );
    });
  }

  private showConsolePair(error = ''): void {
    const pin = h('input', { placeholder: t('console.pin'), 'aria-label': t('console.pin'), inputMode: 'numeric', maxLength: 6, autocomplete: 'off', enterkeyhint: 'go' });
    const err = h('p', { class: 'err', role: 'alert' }, error);
    const go = async () => {
      const r = await pairConsole(pin.value.trim());
      if (r.ok) {
        consoleToken.set(r.token);
        return this.showConsole();
      }
      err.textContent = t(r.reason === 'wrong' ? 'console.wrongPin' : r.reason === 'many' ? 'console.tooMany' : r.reason === 'notv' ? 'console.noTv' : r.reason === 'off' ? 'console.off' : 'conn.unreachable');
    };
    pin.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      void go();
    });
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h1', {}, t('console.title')),
        h('p', { class: 'sub' }, t('console.pinPrompt')),
        pin,
        h('button', { class: 'btn', onClick: () => void go() }, t('console.pair')),
        h('button', { class: 'btn alt small', onClick: () => this.showMenu() }, t('link.mainMenu')),
        err,
      ),
    );
  }

  showJoinLink(code: string, error = '', askPassword = false, password = ''): void {
    const name = h('input', { placeholder: t('menu.nickname'), 'aria-label': t('menu.nickname'), maxLength: 16, value: nameStore.get() || cachedProfile()?.name || '', autocomplete: 'off' });
    const nick = () => {
      const n = name.value.trim() || t('menu.player');
      nameStore.set(n);
      return n;
    };
    const pw = askPassword
      ? h('input', { type: 'password', placeholder: t('join.password'), 'aria-label': t('join.password'), maxLength: MAX_PASSWORD_LENGTH, value: password, autocomplete: 'off' })
      : null;
    const pwValue = () => pw?.value.trim() || undefined;
    const join = () => this.handlers.onJoinLink(nick(), code, pwValue());
    // phone keyboards: Enter walks name -> password -> join instead of doing nothing
    name.setAttribute('enterkeyhint', pw ? 'next' : 'go');
    pw?.setAttribute('enterkeyhint', 'go');
    name.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (pw) pw.focus();
      else join();
    });
    pw?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      join();
    });
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h1', { 'data-brand': 'name' }, brandName()),
        h('p', { class: 'sub' }, t('link.invited')),
        h('p', { class: 'code-big' }, code),
        name,
        pw,
        guestToggle(),
        h('button', { class: 'btn', onClick: join }, t('link.joinPlayer')),
        h('button', { class: 'btn alt', onClick: () => this.handlers.onWatch(code, pwValue()) }, t('link.watch')),
        h('button', { class: 'btn alt small', onClick: () => this.showMenu() }, t('link.mainMenu')),
        h('p', { class: 'err', role: 'alert' }, error),
      ),
    );
    // the password prompt, or an empty nickname, is what the guest has to fill in next
    (pw && !pw.value ? pw : !name.value ? name : null)?.focus();
  }

  showMenu(error = ''): void {
    if (session.code) return this.showRoomMenu();
    const route = parseLocation(location.pathname, location.search);
    const prefill = route.view === 'room' ? route.code : '';
    replacePath('/');
    const name = h('input', { placeholder: t('menu.nickname'), 'aria-label': t('menu.nickname'), maxLength: 16, value: nameStore.get(), autocomplete: 'off' });
    // no maxLength: a pasted invite link must reach the input handler before it is cut down to the code
    const code = h('input', { class: 'code', placeholder: t('menu.roomCode'), 'aria-label': t('menu.roomCode'), value: prefill, autocomplete: 'off' });
    const nick = () => {
      const n = name.value.trim() || t('menu.player');
      nameStore.set(n);
      return n;
    };
    // phone keyboards: the 4-letter code must not be autocorrected or lowercased, and Enter moves on
    code.setAttribute('autocapitalize', 'characters');
    code.setAttribute('autocorrect', 'off');
    code.spellcheck = false;
    name.setAttribute('enterkeyhint', 'next');
    code.setAttribute('enterkeyhint', 'go');
    name.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      code.focus();
    });
    code.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.handlers.onJoin(nick(), code.value);
    });
    // "Install app": a button where the browser offers one, a short how-to on iOS, nothing otherwise
    const installSlot = h('div', {});
    const paintInstall = () => {
      const mode = currentInstallMode();
      installSlot.replaceChildren(
        ...(mode === 'prompt'
          ? [h('button', { class: 'btn alt', onClick: () => void promptInstall() }, t('install.button'))]
          : mode === 'ios'
            ? [h('p', { class: 'hint' }, t('install.ios'))]
            : []),
      );
    };
    paintInstall();
    const stopInstall = onInstallChange(() => (installSlot.isConnected ? paintInstall() : stopInstall()));
    const joinBtn = h('button', { class: prefill ? 'btn' : 'btn alt', onClick: () => this.handlers.onJoin(nick(), code.value) }, t('menu.join'));
    code.addEventListener('input', () => {
      code.value = cleanRoomCodeInput(code.value);
      joinBtn.className = code.value.length === ROOM_CODE_LENGTH ? 'btn' : 'btn alt'; // a complete code makes Join the main action
    });
    // the room this browser last played in, offered only while that room is still listed
    const rejoin = h('div');
    const last = loadLastRoom();
    if (last && !prefill) {
      const offer = () => {
        if (rejoin.isConnected) rejoin.append(h('button', { class: 'btn', onClick: () => this.handlers.onJoin(nick(), last.code) }, t('menu.rejoin', { code: last.code })));
      };
      void fetch('/rooms?format=json', { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error('rooms listing unavailable');
          return r.json() as Promise<{ code: string }[]>;
        })
        .then((list) => {
          // the listing holds every room (locked and password ones too), so a successful answer is authoritative
          if (list.some((r) => r.code === last.code)) offer();
          else clearLastRoom();
        })
        .catch(offer); // listing blocked or unreadable: still offer it, the join answers ROOM_NOT_FOUND if the room is gone
    }
    // open lobbies whose hosts chose to list them (password rooms are left out: a button cannot enter them)
    const publicRooms = h('div');
    if (!prefill) {
      void fetch('/api/rooms', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ rooms: { code: string; game: string; players: number; maxPlayers: number; passwordProtected: boolean }[] }>) : { rooms: [] }))
        .then(({ rooms }) => {
          const open = rooms.filter((r) => !r.passwordProtected).slice(0, 5);
          if (!publicRooms.isConnected || open.length === 0) return;
          publicRooms.append(
            h('p', { class: 'sub', style: 'margin:14px 0 6px' }, t('menu.publicRooms')),
            ...open.map((r) => h('button', { class: 'btn alt', onClick: () => this.handlers.onJoin(nick(), r.code) }, `${r.code} · ${r.game} · ${r.players}/${r.maxPlayers}`)),
          );
        })
        .catch(() => undefined);
    }
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h1', { 'data-brand': 'name' }, brandName()),
        h('p', { class: 'sub', 'data-brand': 'tagline' }, welcomeMessage() || t('menu.tagline')),
        presenceBadge(),
        name,
        guestToggle(),
        rejoin,
        h('button', { class: 'btn', onClick: () => this.showCreate(nick()) }, t('menu.create')),
        h('p', { class: 'sub', style: 'margin:14px 0 6px' }, t('menu.orJoin')),
        code,
        joinBtn,
        publicRooms,
        h('button', { class: 'btn alt', onClick: () => this.showProfile() }, t('menu.profile')),
        this.announceSlot(),
        h('button', { class: 'btn alt', onClick: () => this.showSettings('menu') }, t('menu.settings')),
        installSlot,
        h('p', { class: 'err', role: 'alert' }, error),
        h(
          'p',
          { class: 'sub', style: 'margin:10px 0 0;font-size:11px;opacity:.6' },
          h('span', { 'aria-label': t('menu.version') }, `v${APP_VERSION}`),
          ' · ',
          h('a', { href: '/admin', style: 'color:inherit' }, t('menu.admin')),
        ),
      ),
    );
    this.showNav();
  }

  /** Kept for callers of the old Controls screen: everything now lives in the settings hub. */
  showControls(): void {
    this.showSettings('menu');
  }

  /**
   * Settings hub: sound, language, connection, keyboard and emote keys, accessibility and on-screen
   * controls in one dialog. `from` says where Back returns: the main/room menu or the in-game menu.
   */
  showSettings(from: 'menu' | 'game' = 'menu'): void {
    const back = () => (from === 'game' ? this.showGameMenu() : this.showMenu());
    const quality = qualityOf(this.handlers.rtt());
    const group = (title: string, open: boolean, ...children: (Node | null)[]) =>
      h('details', { class: 'settings-group', open }, h('summary', {}, title), ...children);
    const panel = h(
      'div',
      { class: 'panel settings' },
      h('h2', {}, t('settings.title')),
      group(
        t('settings.general'),
        true,
        langSelect(() => this.showSettings(from)),
        h('p', { class: 'hint' }, `${t('settings.connection')}: ${t(`net.${quality}` as MessageKey)}${this.handlers.rtt() ? ` (${Math.round(this.handlers.rtt())} ms)` : ''}`),
      ),
      group(t('settings.sound'), true, soundToggle(), volumeEditor()),
      group(t('menu.controls'), false, controlsEditor(), emoteKeysEditor(), touchEditor()),
      group(t('access.title'), false, accessEditor()),
      h('button', { class: 'btn alt', onClick: back }, t('profile.back')),
    );
    if (from === 'game') {
      this.show(panel);
      this.root.classList.add('over');
    } else this.paint(panel, false);
  }

  // ---- profile -------------------------------------------------------------------------------

  /** Profile: info, stats, customization, presets and controls. */
  showProfile(tab: 'info' | 'stats' | 'recent' | 'customize' | 'presets' | 'controls' = 'info'): void {
    if (isGuest()) {
      this.showMenu(t('menu.guest'));
      return;
    }
    if (!session.code) replacePath(profilePath());
    const key = loadProfileKey();
    const cached = cachedProfile();
    let saved: ProfileRecord | null = cached;
    let loadError = false;
    let loading = true;
    const draft = {
      name: cached?.name ?? nameStore.get(),
      color: cached?.color ?? 0,
      // a profile cached before character models had one flat `look`
      looks: sanitizeLooks(cached?.looks ?? (cached as { look?: unknown } | null)?.look),
      avatar: sanitizeAvatar(cached?.avatar),
      /** the model being edited (not saved) */
      model: avatarModel(cached?.avatar)?.id,
    };
    let dirty = false;
    let note = '';
    let current = tab;
    let saveBtn: HTMLButtonElement | null = null;
    const date = (ms: number) => new Date(ms).toLocaleDateString(getLang());
    /** after a slow fetch: the player may have gone back to the room meanwhile */
    const stale = () => !!session.code && !this.away;

    const render = () => {
      const stats = saved?.stats;
      const tabs = (['info', 'stats', 'recent', 'customize', 'presets', 'controls'] as const).map((id) =>
        h(
          'button',
          {
            class: 'btn small' + (id === current ? '' : ' alt'),
            'aria-pressed': String(id === current),
            onClick: () => {
              current = id;
              render();
            },
          },
          t(`profile.${id}` as MessageKey),
        ),
      );
      let body: HTMLElement;
      if (current === 'info') body = this.profileInfo(key, saved, date, () => this.showProfile('info'));
      else if (current === 'stats') body = this.profileStats(stats);
      else if (current === 'recent') body = this.profileRecent(saved?.recent, date);
      else if (current === 'presets') {
        body = this.profilePresets(saved?.presets ?? EMPTY_PRESETS, async (next) => {
          try {
            saved = await saveProfile(key, { presets: next });
            note = '';
          } catch {
            note = t('presets.saveFailed');
          }
          render();
        });
      } else if (current === 'controls') body = h('div', {}, controlsEditor(), emoteKeysEditor(), accessEditor(), touchEditor());
      else {
        body = this.profileEditor(
          draft,
          () => {
            dirty = true;
            note = '';
            render();
          },
          () => {
            dirty = true;
            note = '';
            saveBtn?.removeAttribute('disabled');
          },
          render,
        );
      }
      const save = h(
        'button',
        {
          class: 'btn',
          disabled: loading || !dirty,
          onClick: async () => {
            const name = draft.name.trim().slice(0, MAX_NAME_LENGTH) || t('menu.player');
            try {
              saved = await saveProfile(key, { name, color: draft.color, looks: draft.looks, avatar: draft.avatar ?? '' });
              draft.name = saved.name;
              nameStore.set(saved.name);
              dirty = false;
              note = t('profile.saved');
            } catch {
              note = t('profile.saveFailed');
            }
            render();
          },
        },
        t('profile.save'),
      );
      saveBtn = save;
      this.paint(
        h(
          'div',
          { class: 'panel profile' },
          h('h2', {}, t('profile.title')),
          h('div', { class: 'row tabs' }, ...tabs),
          loading ? h('p', { class: 'sub' }, t('profile.loading')) : body,
          loadError ? h('p', { class: 'err', role: 'alert' }, t('profile.loadFailed')) : null,
          current === 'customize' ? save : null,
          note ? h('p', { class: 'hint', role: 'status' }, note) : null,
          h('button', { class: 'btn alt', onClick: () => this.showMenu() }, t('profile.back')),
        ),
        false,
      );
    };
    render();
    fetchProfile(key).then(
      (rec) => {
        loading = false;
        if (rec) {
          saved = rec;
          applyProfileLang(rec);
          if (!dirty) {
            draft.name = rec.name;
            draft.color = rec.color;
            draft.looks = sanitizeLooks(rec.looks);
            draft.avatar = sanitizeAvatar(rec.avatar);
            draft.model = avatarModel(draft.avatar)?.id;
          }
        }
        if (!stale()) render();
      },
      () => {
        loading = false;
        loadError = true;
        if (!stale()) render();
      },
    );
  }

  private profileInfo(key: string, rec: ProfileRecord | null, date: (ms: number) => string, refresh: () => void): HTMLElement {
    const code = h('input', { value: key, readOnly: true, 'aria-label': t('profile.code'), style: 'font-size:.85rem' });
    const copy = async (text: string, done: string) => {
      try {
        await navigator.clipboard.writeText(text);
        this.toast(done);
      } catch {
        window.prompt(t('toast.copyPrompt'), text);
      }
    };
    return h(
      'div',
      {},
      h('p', { class: 'sub' }, rec ? t('profile.since', { date: date(rec.createdAt) }) : ''),
      h('p', { class: 'sub' }, `${t('profile.name')}: ${rec?.name ?? nameStore.get() ?? ''}`),
      h('p', { class: 'sub' }, `${t('lang.label')}: ${LANG_FLAGS[getLang()]} ${LANG_NAMES[getLang()]}`),
      rec && rec.stats.lastPlayed
        ? h('p', { class: 'sub' }, t('profile.lastPlayed', { date: date(rec.stats.lastPlayed) }))
        : h('p', { class: 'sub' }, t('profile.lastPlayed', { date: t('profile.never') })),
      h('h2', {}, t('profile.code')),
      code,
      h('p', { class: 'hint' }, t('profile.codeHint')),
      h(
        'button',
        {
          class: 'btn small',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(key);
              this.toast(t('profile.copied'));
            } catch {
              code.select();
            }
          },
        },
        t('profile.copy'),
      ),
      h(
        'button',
        {
          class: 'btn small alt',
          onClick: async () => {
            const raw = window.prompt(t('profile.importPrompt'));
            if (raw === null) return;
            if (await applyRecoveryInput(raw)) {
              this.toast(t('profile.imported'));
              refresh();
            } else this.toast(t('profile.importBad'));
          },
        },
        t('profile.import'),
      ),
      h('h2', {}, t('profile.share')),
      h('p', { class: 'hint' }, t('profile.shareHint')),
      h('button', { class: 'btn small', onClick: () => void copy(recoveryLink(key), t('profile.linkCopied')) }, t('profile.copyLink')),
      ...profileSectionSlots(key, (text) => this.toast(text), () => CATALOG.map((g) => ({ id: g.id, name: g.name }))),
    );
  }

  private profilePresets(p: Presets, update: (next: Presets) => void): HTMLElement {
    if (p.variants.length === 0 && p.playlists.length === 0) return h('p', { class: 'sub' }, t('presets.none'));
    const item = (kind: 'variant' | 'playlist', id: string, name: string, detail: string) =>
      h(
        'li',
        {},
        h('span', { class: 'grow' }, h('b', {}, name), h('small', {}, ` ${detail}`)),
        h(
          'span',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'btn icon alt',
              title: t('presets.rename'),
              'aria-label': t('presets.rename'),
              onClick: () => {
                const next = window.prompt(t('presets.renamePrompt'), name)?.trim();
                if (next) update(renamePreset(p, kind, id, next.slice(0, 24)));
              },
            },
            '✎',
          ),
          h('button', { class: 'btn icon alt', title: t('presets.delete'), 'aria-label': t('presets.delete'), onClick: () => update(removePreset(p, kind, id)) }, '✕'),
        ),
      );
    return h(
      'div',
      {},
      p.variants.length ? h('h2', {}, t('presets.variants')) : null,
      p.variants.length
        ? h('ul', { class: 'players' }, ...p.variants.map((v) => item('variant', v.id, v.name, `${entryName(v)}${entryOptions(v) ? ` (${entryOptions(v)})` : ''}`)))
        : null,
      p.playlists.length ? h('h2', {}, t('presets.playlists')) : null,
      p.playlists.length
        ? h('ul', { class: 'players' }, ...p.playlists.map((pl) => item('playlist', pl.id, pl.name, t('presets.rounds', { n: pl.entries.length }))))
        : null,
    );
  }

  private profileStats(s: ProfileStats | undefined): HTMLElement {
    if (!s || (s.matches === 0 && s.gamesPlayed === 0)) return h('p', { class: 'sub' }, t('profile.noStats'));
    const cell = (label: string, value: string | number) => h('div', { class: 'stat' }, h('b', {}, String(value)), h('span', {}, label));
    const games = Object.entries(s.games).sort((a, b) => b[1].played - a[1].played);
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'stats-grid' },
        cell(t('profile.matches'), s.matches),
        cell(t('profile.wins'), s.wins),
        cell(t('profile.winRate'), `${winRate(s)}%`),
        cell(t('profile.points'), s.points),
        cell(t('profile.games'), s.gamesPlayed),
        cell(t('profile.best'), s.bestMatchScore),
      ),
      games.length ? h('h2', { style: 'margin-top:14px' }, t('profile.perGame')) : null,
      ...games.map(([id, g]) =>
        h('p', { class: 'sub game-row' }, h('b', {}, tr(CATALOG.find((c) => c.id === id)?.name ?? id)), ` ${t('profile.gameRow', { n: g.played, w: g.wins, p: g.points })}`),
      ),
    );
  }

  private profileRecent(recent: MatchSummary[] | undefined, date: (ms: number) => string): HTMLElement {
    if (!recent?.length) return h('p', { class: 'sub' }, t('profile.noRecent'));
    const gameName = (id: string) => tr(CATALOG.find((c) => c.id === id)?.name ?? id);
    return h(
      'ul',
      { class: 'players' },
      ...recent.map((m) =>
        h(
          'li',
          { class: 'recent-match' },
          h(
            'details',
            {},
            h('summary', {}, h('b', {}, `#${m.place}`), ` ${t('profile.recentRow', { date: date(m.ts), n: m.players, p: m.score })}`, m.mvp ? ` ${t('final.mvpBadge')}` : ''),
            ...m.rounds.map((r, i) => h('p', { class: 'sub' }, t('profile.recentRound', { n: i + 1, game: gameName(r.game), place: r.place, p: r.points }))),
          ),
        ),
      ),
    );
  }

  private profileEditor(
    draft: { name: string; color: number; looks: Looks; avatar?: string; model?: string },
    changed: () => void,
    typed: () => void,
    rerender: () => void,
  ): HTMLElement {
    const models = characterModels();
    const model: CharacterModel | undefined = characterModel(draft.model) ?? avatarModel(draft.avatar);
    const look = model ? lookOf(draft.looks, model) : {};
    const preview = h('canvas', { width: 180, height: 180, class: 'preview', 'aria-hidden': 'true' });
    const paint = () => paintCharacter(preview, model?.id, look, draft.color);
    paint();
    // a model of a game pack is drawn once that game's code is loaded
    if (model?.owner.kind === 'game') void ensureModel(model.id).then(paint);
    const name = h('input', {
      value: draft.name,
      maxLength: MAX_NAME_LENGTH,
      'aria-label': t('profile.name'),
      placeholder: t('menu.nickname'),
      autocomplete: 'off',
      onInput: () => {
        draft.name = name.value;
        typed();
      },
    });
    const swatches = PALETTE.map((c, i) =>
      h('button', {
        class: 'swatch' + (i === draft.color ? ' on' : ''),
        style: `background:${hex(c)}`,
        'aria-label': `${t('profile.color')} ${i + 1}`,
        'aria-pressed': String(i === draft.color),
        onClick: () => {
          draft.color = i;
          changed();
        },
      }),
    );
    const setLook = (next: Record<string, number>) => {
      if (!model) return;
      draft.looks = { ...draft.looks, [model.id]: next };
      changed();
    };
    // an option is translated in the context of its slot first ("Hair: None"), as the same word may differ per slot
    const optionLabel = (slot: CharacterSlot, i: number) => {
      const label = slot.options[i]?.label ?? '';
      const key = `${slot.label}: ${label}`;
      const inSlot = tr(key);
      return inSlot !== key ? inSlot : tr(label);
    };
    const slot = (sl: CharacterSlot) => {
      const count = sl.options.length;
      const cur = look[sl.id] ?? sl.default;
      const swatch = sl.options[cur]?.swatch;
      return h(
        'div',
        { class: 'slot' },
        h('span', { class: 'slot-name' }, tr(sl.label)),
        h('button', { class: 'btn small', 'aria-label': t('profile.prev'), onClick: () => setLook({ ...look, [sl.id]: (cur - 1 + count) % count }) }, '‹'),
        h(
          'span',
          { class: 'slot-val' },
          swatch !== undefined ? h('span', { class: 'slot-swatch', style: `background:${hex(swatch)}`, 'aria-hidden': 'true' }) : null,
          optionLabel(sl, cur),
        ),
        h('button', { class: 'btn small', 'aria-label': t('profile.next'), onClick: () => setLook({ ...look, [sl.id]: (cur + 1) % count }) }, '›'),
      );
    };
    const isAvatar = !!model && avatarModel(draft.avatar)?.id === model.id;
    return h(
      'div',
      {},
      name,
      preview,
      h('h2', {}, t('profile.color')),
      h('div', { class: 'swatches' }, ...swatches),
      h('p', { class: 'hint' }, t('profile.colorHint')),
      h('h2', {}, t('profile.character')),
      ...(!model
        ? [h('p', { class: 'hint' }, t('profile.noModels'))]
        : [
            models.length > 1
              ? h(
                  'div',
                  { class: 'row wrap', role: 'group', 'aria-label': t('profile.models') },
                  ...models.map((m) =>
                    h(
                      'button',
                      {
                        class: 'btn small' + (m.id === model.id ? '' : ' alt'),
                        'aria-pressed': String(m.id === model.id),
                        onClick: () => {
                          draft.model = m.id;
                          // switching models is not an edit: redraw without marking the profile changed
                          rerender();
                        },
                      },
                      tr(m.name),
                    ),
                  ),
                )
              : null,
            ...model.slots.map(slot),
            h(
              'div',
              { class: 'row wrap' },
              h('button', { class: 'btn small alt', onClick: () => setLook(randomLook(model)) }, t('profile.random')),
              h('button', { class: 'btn small alt', onClick: () => setLook(defaultLook(model)) }, t('profile.reset')),
              models.length > 1
                ? h(
                    'button',
                    {
                      class: 'btn small' + (isAvatar ? '' : ' alt'),
                      'aria-pressed': String(isAvatar),
                      onClick: () => {
                        draft.avatar = model.id;
                        changed();
                      },
                    },
                    t('profile.avatar'),
                  )
                : null,
            ),
          ]),
    );
  }

  // ---- create room / change game -------------------------------------------------------------

  showCreate(name: string, change?: ChangeMode): void {
    const offered = enabledCatalog();
    let games = offered;
    const tagSel = new Set<GameTag>();
    const start = change ? { ...session.selection } : loadSelection();
    const initial = isSelectionEnabled(start) ? start : { ...DEFAULT_SELECTION };
    void refreshDisabled().then((changedList) => {
      if (changedList && this.root.isConnected) this.showCreate(name, change);
    });

    const gameSel = h('select', { class: 'sel', 'aria-label': t('create.game') });
    const fillGames = (want: string) => {
      gameSel.replaceChildren(h('option', { value: MIXED }, t('create.mixed')), ...games.map((g) => h('option', { value: g.id }, g.name)));
      gameSel.value = games.some((g) => g.id === want) ? want : MIXED;
    };
    fillGames(initial.game);
    const tagNone = h('p', { class: 'hint' }, t('tags.none'));
    tagNone.hidden = true;
    const tagSlot = h('div', {});
    const variantSel = h('select', { class: 'sel', 'aria-label': t('create.variant') });
    const variantLabel = h('p', { class: 'sub', style: 'margin:10px 0 6px' }, t('create.variant'));
    const advanced = h('details', { class: 'advanced' });
    let values: Record<string, OptionValue> = {};
    let defs: OptionDef[] = [];
    // Change mode starts from the options the room is running, not the host's saved creation defaults.
    let pendingOptions: Record<string, OptionValue> | null =
      change && initial.game === session.selection.game && initial.variant === session.selection.variant ? { ...session.selection.options } : null;
    const gameDesc = h('p', { class: 'desc' });
    const variantDesc = h('p', { class: 'desc' });
    const guideSlot = h('div', {});
    const limitHint = h('p', { class: 'hint' });

    const currentGame = (): CatalogGame | undefined => games.find((g) => g.id === gameSel.value);
    const currentVariant = () => (variantSel.hidden ? ALL_VARIANTS : variantSel.value);

    const describe = () => {
      const g = CATALOG.find((c) => c.id === gameSel.value);
      gameDesc.textContent = tr(g ? g.description : MIXED_DESCRIPTION);
      const v = g?.variants.find((x) => x.id === variantSel.value);
      variantDesc.textContent = tr(v ? v.description : ALL_VARIANTS_DESCRIPTION);
      variantDesc.hidden = variantSel.hidden;
      tagSlot.replaceChildren(tagChips(g ? tagsOf(g, v) : []));
      const wasOpen = guideSlot.querySelector('details')?.open ?? false;
      const guide = guideFor(gameSel.value, variantSel.hidden ? ALL_VARIANTS : variantSel.value) as HTMLDetailsElement;
      guide.open = wasOpen;
      guideSlot.replaceChildren(guide);
      const limit = selectionLimit(gameSel.value, currentVariant());
      limitHint.textContent = limit === undefined ? '' : t('create.maxPlayers', { n: limit });
      limitHint.hidden = limit === undefined;
    };
    const fillVariants = (want?: string) => {
      const g = currentGame();
      const has = !!g && g.variants.length > 0;
      variantSel.hidden = variantLabel.hidden = !has;
      variantSel.replaceChildren();
      if (!has) return describe();
      variantSel.append(h('option', { value: ALL_VARIANTS }, t('create.allVariants')));
      for (const v of g.variants) variantSel.append(h('option', { value: v.id }, v.name));
      variantSel.value = want && g.variants.some((v) => v.id === want) ? want : ALL_VARIANTS;
      describe();
    };
    const fillOptions = () => {
      const game = gameSel.value;
      const variant = currentVariant();
      defs = game === MIXED ? [] : optionsFor(game, variant);
      advanced.hidden = defs.length === 0;
      advanced.replaceChildren();
      if (defs.length === 0) return;
      values = { ...defaultOptions(defs), ...(pendingOptions ?? loadOptions(game, variant)) };
      pendingOptions = null;
      const sources = optionSources(game, variant);
      const variantName = CATALOG.find((c) => c.id === game)?.variants.find((v) => v.id === variant)?.name ?? '';
      const remember = () => {
        if (!change) saveOptions(game, variant, changedOptions(defs, values));
      };
      advanced.append(
        h('summary', {}, t('create.advanced')),
        ...renderGroupedOptions(defs, values, remember, sources, variantName),
        h(
          'button',
          {
            class: 'btn alt small',
            type: 'button',
            onClick: () => {
              if (change) pendingOptions = {};
              else saveOptions(game, variant, {});
              fillOptions();
              advanced.open = true;
            },
          },
          t('create.reset'),
        ),
      );
    };
    gameSel.addEventListener('change', () => {
      fillVariants();
      fillOptions();
    });
    variantSel.addEventListener('change', () => {
      describe();
      fillOptions();
    });
    const tagBar = tagFilter(tagsInUse(offered), tagSel, () => {
      const keepGame = gameSel.value;
      const keepVariant = currentVariant();
      games = enabledCatalog([...tagSel]);
      tagNone.hidden = tagSel.size === 0 || games.length > 0;
      fillGames(keepGame);
      fillVariants(keepVariant);
      fillOptions();
    });
    fillVariants(initial.variant);
    fillOptions();
    if (change) advanced.open = true;
    if (change?.optionsOnly) gameSel.disabled = variantSel.disabled = true;

    const submit = () => {
      const sel = normalizeSelection(gameSel.value, currentVariant(), changedOptions(defs, values)) ?? { ...DEFAULT_SELECTION };
      if (change) {
        const conflict = playerCountConflict(sel, session.players.length);
        if (conflict) return this.toast(t('create.tooMany', { game: conflict.name, max: conflict.max, n: session.players.length }));
        return change.onConfirm(sel);
      }
      saveSelection(sel);
      this.handlers.onCreate(name, sel, sanitizePassword(this.createPassword) ?? undefined, this.createPublic);
    };

    // saved variants
    const loadSel = h('select', { class: 'sel', 'aria-label': t('presets.loadVariant') });
    const fillSaved = (list: Presets['variants']) => {
      loadSel.replaceChildren(h('option', { value: '' }, t('presets.loadVariant')), ...list.map((v) => h('option', { value: v.id }, `${v.name} (${entryName(v)})`)));
      loadSel.hidden = list.length === 0;
    };
    const usable = (list: Presets['variants']) => list.filter(isEntryEnabled);
    let saved = usable(currentPresets().variants);
    fillSaved(saved);
    void refreshPresets().then((p) => {
      saved = usable(p.variants);
      fillSaved(saved);
    });
    loadSel.addEventListener('change', () => {
      const v = saved.find((x) => x.id === loadSel.value);
      loadSel.value = '';
      if (!v) return;
      gameSel.value = v.game;
      fillVariants(v.variant);
      pendingOptions = v.options;
      fillOptions();
      advanced.open = true;
    });
    const saveVariant = async () => {
      const g = CATALOG.find((c) => c.id === gameSel.value);
      if (!g || (g.variants.length > 0 && currentVariant() === ALL_VARIANTS)) return this.toast(t('presets.pickVariant'));
      const label = window.prompt(t('presets.variantName'))?.trim();
      if (!label) return;
      const next = addVariant(currentPresets(), { name: label, game: g.id, variant: g.variants.length ? currentVariant() : ALL_VARIANTS, options: changedOptions(defs, values) });
      if (!next) return this.toast(t('presets.full'));
      try {
        const p = await savePresets(next);
        saved = usable(p.variants);
        fillSaved(saved);
        this.toast(t('presets.saved'));
      } catch {
        this.toast(t('presets.saveFailed'));
      }
    };

    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, t(change?.optionsOnly ? 'host.gameOptions' : change ? 'host.changeGame' : 'create.title')),
        change?.optionsOnly ? null : loadSel,
        change?.optionsOnly ? null : tagBar,
        change?.optionsOnly ? null : tagNone,
        h('p', { class: 'sub', style: 'margin:0 0 6px' }, t('create.game')),
        gameSel,
        gameDesc,
        variantLabel,
        variantSel,
        variantDesc,
        tagSlot,
        limitHint,
        guideSlot,
        advanced,
        change?.optionsOnly ? null : h('button', { class: 'btn alt small', onClick: () => void saveVariant() }, t('presets.saveVariant')),
        change?.optionsOnly ? null : h('button', { class: 'btn alt small', onClick: () => this.showPlaylist(name, change) }, t('playlist.open')),
        change ? null : this.passwordField(),
        change ? null : this.publicField(),
        h('button', { class: 'btn', onClick: submit }, t(change ? 'host.applyGame' : 'menu.create')),
        h('button', { class: 'btn alt', onClick: () => (change ? change.onBack() : this.showMenu()) }, t('create.back')),
      ),
    );
  }

  private publicField(): HTMLElement {
    const box = h('input', { type: 'checkbox', checked: this.createPublic });
    box.addEventListener('change', () => {
      this.createPublic = box.checked;
    });
    return h('label', { class: 'sub', style: 'display:block;margin:8px 0' }, box, ' ', t('create.public'));
  }

  private passwordField(): HTMLElement {
    const input = h('input', { type: 'password', placeholder: t('create.password'), 'aria-label': t('create.password'), maxLength: MAX_PASSWORD_LENGTH, value: this.createPassword, autocomplete: 'off' });
    input.addEventListener('input', () => {
      this.createPassword = input.value;
    });
    return input;
  }

  // ---- custom playlists ----------------------------------------------------------------------

  showPlaylist(name: string, change?: ChangeMode, initial?: PlaylistEntry[], initialWins?: number): void {
    const rounds: PlaylistEntry[] = (initial ?? []).map((e) => ({ ...e, options: { ...e.options } }));
    let wins = initialWins ?? (change ? session.selection.playlistRoundsToWin : undefined);
    let open = -1;
    let presets = currentPresets();
    let hint = '';
    const offered = enabledCatalog();
    const tagSel = new Set<GameTag>();
    let games = offered;
    void refreshDisabled().then((changedList) => {
      if (changedList && this.root.isConnected) this.showPlaylist(name, change, rounds, wins);
    });
    let addGame = games[0]!.id;
    const variantsOf = (id: string) => games.find((g) => g.id === id)?.variants ?? [];
    const firstVariant = (id: string) => variantsOf(id)[0]?.id ?? ALL_VARIANTS;
    let addVariantId = firstVariant(addGame);

    const render = () => {
      const prev = this.root.querySelector<HTMLElement>('.panel[data-playlist]');
      const scroll = prev?.scrollTop ?? 0;
      const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= rounds.length) return;
        [rounds[i], rounds[j]] = [rounds[j]!, rounds[i]!];
        open = open === i ? j : open === j ? i : open;
        render();
      };
      const icon = (glyph: string, label: string, onClick: () => void, disabled = false) =>
        h('button', { class: 'btn icon alt', title: label, 'aria-label': label, disabled, onClick }, glyph);
      const items = rounds.map((e, i) => {
        const defsOf = optionsFor(e.game, e.variant);
        const detail = h('p', { class: 'hint' }, entryOptions(e));
        let editor: HTMLElement | null = null;
        if (open === i) {
          const vals: Record<string, OptionValue> = { ...defaultOptions(defsOf), ...e.options };
          editor = h(
            'div',
            { class: 'round-opts' },
            ...(defsOf.length
              ? renderOptions(defsOf, vals, () => {
                  e.options = changedOptions(defsOf, vals);
                  detail.textContent = entryOptions(e);
                })
              : [h('p', { class: 'hint' }, t('playlist.noOptions'))]),
          );
        }
        return h(
          'li',
          { class: 'round' },
          h(
            'div',
            { class: 'round-head' },
            h('b', {}, `${i + 1}.`),
            h('span', { class: 'grow' }, entryName(e)),
            h(
              'span',
              { class: 'actions' },
              icon('↑', t('playlist.up'), () => move(i, -1), i === 0),
              icon('↓', t('playlist.down'), () => move(i, 1), i === rounds.length - 1),
              icon('⚙', t('playlist.options'), () => {
                open = open === i ? -1 : i;
                render();
              }),
              icon(
                '⧉',
                t('playlist.copy'),
                () => {
                  rounds.splice(i + 1, 0, { ...e, options: { ...e.options } });
                  render();
                },
                rounds.length >= MAX_PLAYLIST,
              ),
              icon('✕', t('playlist.remove'), () => {
                rounds.splice(i, 1);
                open = -1;
                render();
              }),
            ),
          ),
          detail,
          editor,
        );
      });

      // with a tag filter on, the lists offer only what matches; the game being added stays valid
      games = enabledCatalog([...tagSel]);
      if (games.length > 0 && !games.some((g) => g.id === addGame)) {
        addGame = games[0]!.id;
        addVariantId = firstVariant(addGame);
      }
      const tagBar = tagFilter(tagsInUse(offered), tagSel, render);
      const gameSel = h('select', { class: 'sel', 'aria-label': t('create.game') }, ...games.map((g) => h('option', { value: g.id }, g.name)));
      gameSel.value = addGame;
      if (games.length > 0 && !variantsOf(addGame).some((v) => v.id === addVariantId)) addVariantId = firstVariant(addGame);
      const vs = variantsOf(addGame);
      const variantSel = h('select', { class: 'sel', 'aria-label': t('create.variant'), hidden: vs.length === 0 }, ...vs.map((v) => h('option', { value: v.id }, v.name)));
      if (vs.length) variantSel.value = addVariantId;
      gameSel.addEventListener('change', () => {
        addGame = gameSel.value;
        addVariantId = firstVariant(addGame);
        render();
      });
      variantSel.addEventListener('change', () => {
        addVariantId = variantSel.value;
      });

      const full = rounds.length >= MAX_PLAYLIST;
      const savedVariants = presets.variants.filter(isEntryEnabled);
      const addSaved = h(
        'select',
        { class: 'sel', 'aria-label': t('playlist.addSaved'), hidden: savedVariants.length === 0 },
        h('option', { value: '' }, t('playlist.addSaved')),
        ...savedVariants.map((v) => h('option', { value: v.id }, `${v.name} (${entryName(v)})`)),
      );
      addSaved.addEventListener('change', () => {
        const v = presets.variants.find((x) => x.id === addSaved.value);
        if (v && !full) rounds.push({ game: v.game, variant: v.variant, options: { ...v.options } });
        render();
      });
      const operator = serverPlaylists().filter((p) => p.rounds.every(isEntryEnabled));
      const mine = presets.playlists.filter((p) => p.entries.every(isEntryEnabled));
      const loadSel = h(
        'select',
        { class: 'sel', 'aria-label': t('playlist.loadSaved'), hidden: mine.length === 0 && operator.length === 0 },
        h('option', { value: '' }, t('playlist.loadSaved')),
        ...operator.map((p) => h('option', { value: `op:${p.id}` }, `★ ${p.name} (${t('presets.rounds', { n: p.rounds.length })})`)),
        ...mine.map((p) => h('option', { value: p.id }, `${p.name} (${t('presets.rounds', { n: p.entries.length })})`)),
      );
      loadSel.addEventListener('change', () => {
        const op = operator.find((p) => `op:${p.id}` === loadSel.value);
        const entries = op ? op.rounds : mine.find((p) => p.id === loadSel.value)?.entries;
        if (entries) {
          rounds.splice(0, rounds.length, ...entries.map((e) => ({ ...e, options: { ...e.options } })));
          open = -1;
        }
        render();
      });

      const savePlaylist = async () => {
        if (rounds.length === 0) return;
        const label = window.prompt(t('playlist.saveName'))?.trim();
        if (!label) return;
        const next = addPlaylist(presets, label, rounds.map((e) => ({ ...e, options: { ...e.options } })));
        if (!next) {
          hint = t('presets.full');
          return render();
        }
        try {
          presets = await savePresets(next);
          hint = t('presets.saved');
        } catch {
          hint = t('presets.saveFailed');
        }
        render();
      };
      const submit = () => {
        const sel = normalizeSelection(undefined, undefined, undefined, rounds, wins);
        if (!sel) {
          hint = t('playlist.empty');
          return render();
        }
        if (change) {
          const conflict = playerCountConflict(sel, session.players.length);
          if (conflict) {
            hint = t('create.tooMany', { game: conflict.name, max: conflict.max, n: session.players.length });
            return render();
          }
          return change.onConfirm(sel);
        }
        this.handlers.onCreate(name, sel, sanitizePassword(this.createPassword) ?? undefined, this.createPublic);
      };

      const winsDef = ROUNDS_TO_WIN_OPTION;
      const winsVal = h('b', { class: 'val' }, wins === undefined ? t('opt.off') : String(wins));
      const winsInput = h('input', { type: 'range', min: String(winsDef.min), max: String(winsDef.max), step: '1', value: String(wins ?? winsDef.default) });
      winsInput.addEventListener('input', () => {
        wins = Number(winsInput.value);
        winsVal.textContent = String(wins);
      });

      this.show(
        h(
          'div',
          { class: 'panel', 'data-playlist': '1' },
          h('h2', {}, t('playlist.title')),
          h('p', { class: 'sub' }, t('playlist.count', { n: rounds.length, max: MAX_PLAYLIST })),
          loadSel,
          rounds.length ? h('ol', { class: 'rounds edit' }, ...items) : h('p', { class: 'sub' }, t('playlist.empty')),
          h('div', { class: 'opt' }, h('label', {}, h('span', {}, t('playlist.defaultWins')), winsVal), winsInput),
          h('h2', { style: 'margin-top:12px' }, t('playlist.add')),
          tagBar,
          games.length === 0 ? h('p', { class: 'hint' }, t('tags.none')) : null,
          gameSel,
          variantSel,
          h(
            'button',
            {
              class: 'btn alt small',
              disabled: full || games.length === 0,
              onClick: () => {
                rounds.push({ game: addGame, variant: variantsOf(addGame).length ? addVariantId : ALL_VARIANTS, options: {} });
                render();
              },
            },
            t('playlist.addRound'),
          ),
          addSaved,
          hint ? h('p', { class: 'hint', role: 'status' }, hint) : null,
          h('button', { class: 'btn alt small', disabled: rounds.length === 0, onClick: () => void savePlaylist() }, t('playlist.save')),
          change ? null : this.passwordField(),
          h('button', { class: 'btn', disabled: rounds.length === 0, onClick: submit }, t(change ? 'playlist.apply' : 'menu.create')),
          h('button', { class: 'btn alt', onClick: () => (change ? change.onBack() : this.showCreate(name)) }, t('create.back')),
        ),
        false,
      );
      const now = this.root.querySelector<HTMLElement>('.panel[data-playlist]');
      if (now) now.scrollTop = scroll;
    };
    render();
    void refreshPresets().then((p) => {
      presets = p;
      render();
    });
  }

  // ---- lobby ---------------------------------------------------------------------------------

  showLobby(): void {
    const prev = this.root.querySelector<HTMLElement>('.panel[data-lobby]');
    const same = prev && prev.dataset.lobby === session.code ? prev : null;
    const guideOpen = same?.querySelector<HTMLDetailsElement>('details.guide')?.open ?? false;
    const scroll = same?.scrollTop ?? 0;
    const fid = same && same.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.fid : undefined;
    if (this.kickArmed && !session.players.some((p) => p.id === this.kickArmed) && !session.watchers.some((w) => w.id === this.kickArmed)) this.kickArmed = '';
    const me = session.players.find((p) => p.id === session.myId);
    const everyoneReady = session.players.every((p) => p.id === session.hostId || !p.connected || p.ready);
    const waitingOn = session.players.filter((p) => p.id !== session.hostId && p.connected && !p.ready).map((p) => session.labelOf(p.id));
    const notReadyNames = waitingOn.slice(0, 3).join(', ') + (waitingOn.length > 3 ? ` +${waitingOn.length - 3}` : '');
    // the console phone is the host without a seat: it watches and still has the room controls
    const asHost = session.isHost;
    const list = h(
      'ul',
      { class: 'players' },
      ...session.players.map((p) => {
        const plug = lobbyRowSlots(p);
        return h(
          'li',
          { class: p.id === session.myId ? 'me' : '' },
          h('span', { class: 'dot', style: `background:${hex(session.colorOf(p.id))}` }),
          h('span', { class: 'grow' }, session.labelOf(p.id)),
          p.id === session.hostId ? h('span', { class: 'tag' }, t('lobby.host')) : plug.tag ? h('span', { class: 'tag' }, plug.tag) : p.virtual ? h('span', { class: 'tag' }, t('lobby.virtual')) : h('span', { class: 'tag' + (p.ready ? ' ok' : '') }, p.ready ? t('lobby.ready') : '...'),
          session.teams && p.team !== undefined ? this.teamPicker(p.id, p.team, asHost || p.id === session.myId) : null,
          p.id !== session.myId && !session.spectator && !p.virtual ? this.reportButton(p.id) : null,
          ...(asHost ? plug.actions : []),
          asHost && p.id !== session.myId && !p.virtual ? this.playerActions(p.id, p.connected) : null,
        );
      }),
      ...lobbyExtraRows(),
      ...(asHost
        ? session.watchers.map((w) => h('li', {}, h('span', { class: 'grow' }, `👁 ${w.name}`), h('span', { class: 'actions' }, h('button', { class: 'btn icon alt', 'data-fid': `role-${w.id}`, title: t('host.makePlayer'), 'aria-label': t('host.makePlayer'), disabled: session.players.length >= (session.maxPlayers || session.config?.maxPlayers || Infinity), onClick: () => this.handlers.onSetRole(w.id, false) }, '🎮'), this.kickButton(w.id))))
        : []),
    );
    const cap = session.maxPlayers || session.config?.maxPlayers;
    const link = `${linkOrigin()}${roomPath(session.code)}`;
    const showQr = this.lobbyQr ?? session.spectator;
    const full = session.players.length >= (cap ?? Infinity);
    this.show(
      h(
        'div',
        { class: 'panel', 'data-lobby': session.code },
        h('p', { class: 'sub', style: 'margin:0' }, t('lobby.roomCode')),
        h('p', { class: 'code-big' }, session.code),
        ...this.selectionSummary(),
        h('p', { class: 'sub', style: 'font-size:.8rem;word-break:break-all;margin-bottom:6px' }, link),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn alt small', 'data-fid': 'copy-invite', onClick: () => this.handlers.onCopy(false) }, t('lobby.copyInvite')),
          h('button', { class: 'btn alt small', 'data-fid': 'copy-watch', onClick: () => this.handlers.onCopy(true) }, t('lobby.copyWatch')),
        ),
        h(
          'div',
          { class: 'row' },
          typeof navigator.share === 'function'
            ? h('button', { class: 'btn alt small', 'data-fid': 'share', onClick: () => void navigator.share({ url: link }).catch(() => {}) }, t('lobby.share'))
            : null,
          h(
            'button',
            {
              class: 'btn alt small',
              'data-fid': 'qr-toggle',
              onClick: () => {
                this.lobbyQr = !showQr;
                this.showLobby();
              },
            },
            t(showQr ? 'lobby.hideQr' : 'lobby.showQr'),
          ),
        ),
        showQr ? qrSvg(link, session.spectator ? 280 : 200) : null,
        h('h2', { style: 'margin-top:12px' }, t('lobby.players', { n: session.players.length, max: cap ?? '?' })),
        session.locked ? h('p', { class: 'sub', style: 'margin:0 0 6px;color:var(--accent2)' }, t('host.lockedTag')) : null,
        session.passwordProtected ? h('p', { class: 'sub', style: 'margin:0 0 6px' }, `🔒 ${t('lobby.passwordTag')}`) : null,
        ...lobbyInfoSlots(),
        h('span', { class: 'presence', 'data-state': 'ok' }, t('presence.inRoom', { n: session.players.filter((p) => p.connected).length })),
        list,
        session.spectators > 0 ? h('p', { class: 'sub', style: 'margin:0 0 6px' }, t('lobby.watching', { n: session.spectators })) : null,
        session.isHost
          ? h(
              'div',
              {},
              h('button', { class: 'btn', disabled: !everyoneReady, onClick: () => this.handlers.onStart() }, everyoneReady ? t('lobby.start') : t('lobby.waitingFor', { names: notReadyNames })),
              everyoneReady ? null : h('button', { class: 'btn alt small', onClick: () => this.handlers.onStart(true) }, t('lobby.startAnyway')),
              session.spectator ? h('button', { class: 'btn alt small', disabled: full, onClick: () => this.handlers.onPromote() }, t(full ? 'lobby.full' : 'lobby.playToo')) : this.watchInsteadButton(),
            )
          : session.spectator
            ? h('button', { class: 'btn', disabled: full, onClick: () => this.handlers.onPromote() }, t(full ? 'lobby.full' : 'lobby.joinPlayer'))
            : h(
                'div',
                {},
                h('button', { class: 'btn', onClick: () => this.handlers.onReady(!me?.ready) }, me?.ready ? t('lobby.notReady') : t('lobby.imReady')),
                this.watchInsteadButton(),
              ),
        asHost ? this.hostControls() : null,
        guideFor(...this.playingChoice()),
        h('button', { class: 'btn alt small', onClick: () => this.showSettings('menu') }, t('menu.settings')),
        this.leaveButton('btn alt small', { 'data-fid': 'leave' }),
      ),
      same === null,
    );
    this.showNav(); // the lobby keeps the header nav: its links open away views and the room badge brings you back
    const now = this.root.querySelector<HTMLElement>('.panel[data-lobby]');
    if (!now) return;
    const guide = now.querySelector<HTMLDetailsElement>('details.guide');
    if (guide && guideOpen) guide.open = true;
    now.scrollTop = scroll;
    if (fid) now.querySelector<HTMLElement>(`[data-fid="${fid}"]`)?.focus({ preventScroll: true });
  }

  private selectionSummary(): Node[] {
    const sel = session.selection;
    const title = h('p', { class: 'sub', style: 'margin:0 0 4px;font-weight:800;color:var(--accent2)' }, describeSelection(sel));
    if (sel.game === CUSTOM && sel.playlist?.length) {
      return [
        title,
        h(
          'ol',
          { class: 'rounds' },
          ...sel.playlist.map((e) => {
            const o = entryOptions(e);
            return h('li', {}, h('span', {}, entryName(e)), o ? h('small', {}, ` (${o})`) : null);
          }),
        ),
      ];
    }
    const opts = describeOptions(sel);
    return [title, opts.length ? h('p', { class: 'sub', style: 'margin:0 0 6px;font-size:.8rem' }, opts.join(' | ')) : null].filter((x): x is HTMLParagraphElement => !!x);
  }

  // ---- host controls -------------------------------------------------------------------------

  private kickButton(id: string): HTMLElement {
    const armed = this.kickArmed === id;
    return h(
      'button',
      {
        class: 'btn icon' + (armed ? ' danger' : ' alt'),
        'data-fid': `kick-${id}`,
        title: t(armed ? 'host.kickConfirm' : 'host.kick'),
        'aria-label': t(armed ? 'host.kickConfirm' : 'host.kick'),
        onClick: () => {
          if (!armed) {
            this.kickArmed = id;
            return this.showLobby();
          }
          this.kickArmed = '';
          this.handlers.onKick(id);
        },
      },
      armed ? '✓' : '✕',
    );
  }

  /** Two-step: first press arms it (the label changes), the second sends the report. */
  private reportButton(id: string): HTMLElement {
    let armed = false;
    const b = h('button', {
      class: 'btn icon alt',
      'data-fid': `report-${id}`,
      title: t('report.title'),
      'aria-label': t('report.title'),
      onClick: () => {
        if (!armed) {
          armed = true;
          b.textContent = t('report.confirm');
          b.title = b.getAttribute('aria-label') ?? '';
          return;
        }
        this.handlers.onReport(id);
        this.toast(t('report.sent'));
        b.disabled = true;
        b.textContent = '✓';
      },
    }, '⚑');
    return h('span', { class: 'actions' }, b);
  }

  private playerActions(id: string, connected: boolean): HTMLElement {
    const btn = (fid: string, glyph: string, label: string, onClick: () => void, disabled = false) =>
      h('button', { class: 'btn icon alt', 'data-fid': fid, title: label, 'aria-label': label, disabled, onClick }, glyph);
    return h(
      'span',
      { class: 'actions' },
      btn(`host-${id}`, '👑', t('host.makeHost'), () => this.handlers.onMakeHost(id), !connected),
      btn(`role-${id}`, '👁', t('host.makeSpectator'), () => this.handlers.onSetRole(id, true)),
      btn(`reset-${id}`, '✎', t('host.resetName'), () => this.handlers.onResetName(id)),
      this.kickButton(id),
    );
  }

  private passwordControls(): HTMLElement {
    const input = h('input', {
      type: 'password',
      'data-fid': 'host-password',
      placeholder: t('host.passwordPlaceholder'),
      'aria-label': t('host.passwordPlaceholder'),
      maxLength: MAX_PASSWORD_LENGTH,
      value: this.passwordDraft,
      autocomplete: 'off',
    });
    input.addEventListener('input', () => {
      this.passwordDraft = input.value;
    });
    const apply = () => {
      const pw = sanitizePassword(input.value);
      if (!pw) return;
      this.passwordDraft = '';
      this.handlers.onSettings({ password: pw });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply();
    });
    return h(
      'div',
      { class: 'row' },
      h('span', { class: 'slot-name' }, session.passwordProtected ? `🔒 ${t('host.passwordOn')}` : t('host.passwordOff')),
      input,
      h('button', { class: 'btn small', 'data-fid': 'host-password-set', onClick: apply }, session.passwordProtected ? t('host.passwordChange') : t('host.passwordSet')),
      session.passwordProtected
        ? h('button', { class: 'btn small alt', 'data-fid': 'host-password-remove', onClick: () => this.handlers.onSettings({ password: null }) }, t('host.passwordRemove'))
        : null,
    );
  }

  /** Team buttons (in team colours) for one player; only clickable by that player or the host. */
  private teamPicker(playerId: string, team: number, canChange: boolean): HTMLElement {
    const used = Math.max(2, ...session.players.map((q) => (q.team ?? 0) + 1));
    const shown = Math.min(MAX_TEAMS, used + (used < MAX_TEAMS ? 1 : 0));
    const buttons: HTMLElement[] = [];
    for (let i = 0; i < shown; i++) {
      const full = session.teamSize > 0 && i !== team && session.players.filter((q) => q.team === i).length >= session.teamSize;
      buttons.push(
        h(
          'button',
          {
            class: 'btn small' + (i === team ? '' : ' alt'),
            style: `border-left:6px solid ${hex(session.teamColorOf(i))}`,
            'aria-label': t('team.name', { n: i + 1 }),
            'aria-pressed': String(i === team),
            disabled: !canChange || full,
            onClick: () => this.handlers.onSetTeam(i, playerId === session.myId ? undefined : playerId),
          },
          String(i + 1),
        ),
      );
    }
    return h('span', { class: 'actions' }, ...buttons);
  }

  /** Team standings block shown above the player rows in results / final. */
  private teamStandings(teams: TeamResult[]): HTMLElement {
    return h(
      'ul',
      { class: 'players teams' },
      ...teams.map((r) =>
        h(
          'li',
          {},
          h('b', {}, `#${r.place}`),
          h('span', { class: 'dot', style: `background:${hex(session.teamColorOf(r.team))}` }),
          h('span', { class: 'grow' }, t('team.name', { n: r.team + 1 })),
          h('span', { class: 'pts' }, t('final.pts', { n: r.points })),
        ),
      ),
    );
  }

  private hostControls(): HTMLElement {
    const cap = session.config?.maxPlayers ?? 2;
    const current = session.maxPlayers || cap;
    const changeMode = (optionsOnly = false): ChangeMode => ({
      optionsOnly,
      onConfirm: (sel) => {
        this.handlers.onSetSelection(sel);
        this.showLobby();
      },
      onBack: () => this.showLobby(),
    });
    const sel = session.selection;
    const hasGameOptions = sel.game !== MIXED && sel.game !== CUSTOM && optionsFor(sel.game, sel.variant).some((o) => o.id !== 'roundsToWin');
    const box = h(
      'details',
      { class: 'host-controls' },
      h('summary', {}, t('host.title')),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          { class: 'btn small' + (session.locked ? '' : ' alt'), 'data-fid': 'host-lock', 'aria-pressed': String(session.locked), onClick: () => this.handlers.onSettings({ locked: !session.locked }) },
          session.locked ? t('host.unlock') : t('host.lock'),
        ),
      ),
      this.passwordControls(),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          { class: 'btn small' + (session.lateJoin ? '' : ' alt'), 'data-fid': 'host-latejoin', 'aria-pressed': String(session.lateJoin), onClick: () => this.handlers.onSettings({ lateJoin: !session.lateJoin }) },
          session.lateJoin ? t('host.lateJoinOff') : t('host.lateJoinOn'),
        ),
      ),
      session.lateJoin
        ? h(
            'div',
            { class: 'slot' },
            h('span', { class: 'slot-name' }, t('host.catchUp')),
            h('button', { class: 'btn small', 'aria-label': t('host.fewer'), disabled: session.catchUp <= 0, onClick: () => this.handlers.onSettings({ catchUp: Math.max(0, session.catchUp - 10) }) }, '−'),
            h('span', { class: 'slot-val' }, `${session.catchUp}%`),
            h('button', { class: 'btn small', 'aria-label': t('host.more'), disabled: session.catchUp >= 100, onClick: () => this.handlers.onSettings({ catchUp: Math.min(100, session.catchUp + 10) }) }, '+'),
          )
        : null,
      ...lobbyHostSlots(),
      selectionSupportsTeams(session.selection)
        ? h(
            'div',
            { class: 'row' },
            h(
              'button',
              { class: 'btn small' + (session.teams ? '' : ' alt'), 'data-fid': 'host-teams', 'aria-pressed': String(session.teams), onClick: () => this.handlers.onSettings({ teams: !session.teams }) },
              session.teams ? t('host.teamsOff') : t('host.teamsOn'),
            ),
          )
        : null,
      h(
        'div',
        { class: 'slot' },
        h('span', { class: 'slot-name' }, t('host.maxPlayers')),
        h('button', { class: 'btn small', 'aria-label': t('host.fewer'), disabled: current <= Math.max(2, session.players.length), onClick: () => this.handlers.onSettings({ maxPlayers: current - 1 }) }, '−'),
        h('span', { class: 'slot-val' }, String(current)),
        h('button', { class: 'btn small', 'aria-label': t('host.more'), disabled: current >= cap, onClick: () => this.handlers.onSettings({ maxPlayers: current + 1 }) }, '+'),
      ),
      h(
        'button',
        {
          class: 'btn small alt',
          'data-fid': 'host-game',
          onClick: () => {
            if (session.selection.game === CUSTOM) this.showPlaylist('', changeMode(), session.selection.playlist, session.selection.playlistRoundsToWin);
            else this.showCreate('', changeMode());
          },
        },
        t('host.changeGame'),
      ),
      hasGameOptions
        ? h(
            'button',
            { class: 'btn small alt', 'data-fid': 'host-options', onClick: () => this.showCreate('', changeMode(true)) },
            t('host.gameOptions'),
          )
        : null,
    );
    box.open = this.hostPanelOpen;
    box.addEventListener('toggle', () => {
      this.hostPanelOpen = box.open;
    });
    return box;
  }

  // ---- results and final ---------------------------------------------------------------------

  showResults(game: string, placements: Placement[], scores: Record<string, number>, last: boolean, teams?: TeamResult[], stage?: { n: number; of: number; target: number }): void {
    const rows = placements.map((p) =>
      h(
        'li',
        { class: p.id === session.myId ? 'me' : '' },
        h('b', {}, `#${p.place}`),
        h('span', { class: 'dot', style: `background:${hex(session.colorOf(p.id))}` }),
        h('span', { class: 'grow' }, session.labelOf(p.id)),
        h('span', { class: 'pts' }, `+${p.points}`),
        h('span', {}, String(scores[p.id] ?? 0)),
      ),
    );
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, t('results.title', { game })),
        stage && stage.of > 1 ? h('p', { class: 'sub', style: 'margin:0 0 4px' }, t('results.stage', { n: stage.n, of: stage.of })) : null,
        stage && stage.target > 1 ? h('p', { class: 'sub', style: 'margin:0 0 6px' }, t('results.target', { n: stage.target })) : null,
        teams?.length ? this.teamStandings(teams) : null,
        h('ul', { class: 'players' }, ...rows),
        session.isHost ? h('button', { class: 'btn', onClick: () => this.handlers.onNext() }, t(last ? 'results.final' : 'results.next')) : h('p', { class: 'sub' }, t('results.soon')),
        this.takeSeatButton(last),
        session.spectator || last ? null : this.watchInsteadButton(),
      ),
    );
  }

  /** A seated player may give the seat up and watch (lobby and results only). */
  private watchInsteadButton(): HTMLElement {
    return h('button', { class: 'btn alt small', 'data-fid': 'watch-instead', onClick: () => this.handlers.onLeaveSeat() }, t('lobby.watchInstead'));
  }

  /** A watcher may sit down between rounds when the host allows late joins. */
  private takeSeatButton(last: boolean): HTMLElement | null {
    if (!session.spectator || !session.lateJoin || last) return null;
    const full = session.maxPlayers > 0 && session.players.length >= session.maxPlayers;
    return h('button', { class: 'btn', 'data-fid': 'take-seat', disabled: full, onClick: () => this.handlers.onPromote() }, full ? t('lobby.full') : t('results.takeSeat', { pct: session.catchUp }));
  }

  showWaiting(kind: 'results' | 'finished'): void {
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('h1', {}, t(kind === 'results' ? 'waiting.resultsTitle' : 'waiting.finishedTitle')),
        h('p', { class: 'sub' }, t(kind === 'results' ? 'waiting.resultsText' : 'waiting.finishedText')),
        kind === 'results' ? this.takeSeatButton(false) : null,
        h('button', { class: 'btn alt small', onClick: () => this.showSettings('menu') }, t('menu.settings')),
        this.leaveButton('btn alt small'),
      ),
    );
  }

  /** Match over: ranking, then the host asks (by vote) to play again or to go back and change the game. */
  showFinal(ranking: { id: string; name: string; score: number; wins: number }[], teams?: TeamResult[], mvp?: string, rounds?: MatchRound[]): void {
    const winner = ranking[0];
    const winningTeam = teams?.[0];
    const busy = session.vote !== null;
    this.show(
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'trophy' }, '🏆'),
        h('h1', {}, winningTeam ? t('final.wins', { name: t('team.name', { n: winningTeam.team + 1 }) }) : winner ? t('final.wins', { name: winner.name }) : t('final.over')),
        teams?.length ? this.teamStandings(teams) : null,
        mvp ? h('p', { class: 'sub mvp' }, t('final.mvp', { name: ranking.find((r) => r.id === mvp)?.name ?? '?' })) : null,
        h(
          'ul',
          { class: 'players' },
          ...ranking.map((r, i) =>
            h(
              'li',
              { class: r.id === session.myId ? 'me' : '' },
              h('b', {}, `#${i + 1}`),
              h('span', { class: 'dot', style: `background:${hex(session.colorOf(r.id))}` }),
              h('span', { class: 'grow' }, session.labelOf(r.id), h('small', {}, ` ${t('final.roundWins', { n: r.wins })}`)),
              h('span', { class: 'pts' }, t('final.pts', { n: r.score })),
            ),
          ),
        ),
        rounds?.length
          ? h(
              'details',
              { class: 'recap' },
              h('summary', {}, t('final.rounds')),
              ...rounds.map((r, i) => h('p', { class: 'sub' }, h('b', {}, `${i + 1}. ${r.game.name}`), ` ${r.placements.map((p) => `${p.place}. ${p.name} (+${p.points})`).join(', ')}`)),
            )
          : null,
        session.isHost
          ? h('div', {}, h('button', { class: 'btn', disabled: busy, onClick: () => this.handlers.onVoteStart('again') }, t('final.again')), h('button', { class: 'btn alt', disabled: busy, onClick: () => this.handlers.onVoteStart('change') }, t('final.change')))
          : h('p', { class: 'sub' }, t('final.waitHost')),
        h('button', { class: 'btn alt small', onClick: () => this.showSettings('menu') }, t('menu.settings')),
        this.leaveButton('btn alt small'),
      ),
    );
  }
}

/** Most players the chosen game/variant supports, or undefined for no limit. */
function selectionLimit(game: string, variant: string): number | undefined {
  const g = CATALOG.find((c) => c.id === game);
  if (!g) return undefined;
  const v = g.variants.find((x) => x.id === variant);
  return v ? (v.maxPlayers ?? g.maxPlayers) : g.maxPlayers;
}
