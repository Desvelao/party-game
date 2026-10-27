import { brandName, linkOrigin, refreshDisabled, setOnBrandChange } from './catalogState';
import { screenInfo } from './consoleLink';
import { parseMaintenance, setMaintenance, setOnMaintenanceChange } from './maintenance';
import { pluginScreenAt, recoveryHashes, setPluginSink } from './plugins/features';
import { context, loadPlugin, pluginForKind, setActionSink } from './plugins/registry';
import { destroyController, destroyOverlay, hasController, privateController, syncController, syncOverlay } from './plugins/controller';
import './style.css';
import Phaser from 'phaser';
import {
  EMOTES,
  WORLD_SIZE,
  actionFor,
  gameIdOf,
  normalizeRoomCode,
  resolveMotion,
  onLangChange,
  resolveMoveControl,
  resolveShowControls,
  secondaryActionFor,
  t,
  type GameSelection,
  type GameState,
  type MessageKey,
  type MoveControl,
  type ServerMessage,
  type TeamResult,
} from '../../shared';
import { prefersReducedMotion } from './motion';
import { PoorConnectionWatch, barsOf, qualityOf } from './netquality';
import { vibrate } from './haptics';
import { setWakeLock } from './wakelock';
import { music } from './audio/music';
import { sfx } from './audio/sfx';
import { adoptProfileAccessPrefs, loadAccessPrefs, onAccessPrefsChange } from './access-prefs';
import { adoptProfileAudioPrefs, loadAudioPrefs, onAudioPrefsChange } from './audio-prefs';
import { adoptProfileEmoteKeys, loadEmoteKeys, onEmoteKeysChange } from './emote-keys';
import { hasSeenHowTo, markHowToSeen } from './howto-seen';
import { InputController } from './input';
import { Net } from './networking/socket';
import { GameScene } from './scenes/GameScene';
import { endPanelFor } from './panel';
import { errorAction, voteOutcomeKey } from './flow';
import { applyProfileLang, applyRecoveryInput, cachedProfile, fetchProfile, isGuest, loadProfileKey, persistLang } from './profile';
import { adoptProfileControls, loadControls, onControlsChange } from './controls';
import {
  _markTouchSeen,
  adoptProfileTouchPrefs,
  isTouchDevice,
  loadTouchPrefs,
  onTouchPrefsChange,
} from './touch-prefs';
import { parseLocation, profilePath, replacePath, roomPath } from './route';
import { hex, resetSession, session } from './session';
import { cleanRoomCodeInput } from './roomCode';
import { clearLastRoom, clearResume, loadResume, saveLastRoom, saveResume, startupResume } from './reconnect';
import { createReconnectController } from './reconnectController';
import { UI, keyLabel } from './ui/screens';

const net = new Net();
setActionSink((data) => net.send({ t: 'GAME_ACTION', data }));
setPluginSink((plugin, data) => net.send({ t: 'PLUGIN_ACTION', plugin, data }));
const scene = new GameScene();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1033',
  scale: { mode: Phaser.Scale.RESIZE, width: WORLD_SIZE, height: WORLD_SIZE },
  scene: [scene],
  render: { antialias: true },
});

const controlsEl = document.getElementById('controls')!;
const menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;
const emoteBtn = document.getElementById('emote-btn') as HTMLButtonElement;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;
const emoteBar = document.getElementById('emote-bar') as HTMLDivElement;
const emoteFloat = document.getElementById('emote-float') as HTMLDivElement;
EMOTES.forEach((icon, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = icon;
  b.setAttribute('aria-label', t(`emote.${i}` as MessageKey));
  b.dataset.emote = String(i);
  b.addEventListener('click', () => {
    net.send({ t: 'EMOTE', emote: i });
    emoteBar.hidden = true;
    emoteBtn.setAttribute('aria-expanded', 'false');
  });
  emoteBar.append(b);
});
/** Accessibility options live in the session so every renderer and screen reads them in one place. */
function applyAccessPrefs(): void {
  session.access = loadAccessPrefs();
  // CSS animations and transitions follow the same motion level (see style.css)
  document.documentElement.dataset.motion = resolveMotion(session.access.motion, prefersReducedMotion());
  if (session.code) render();
}
onAccessPrefsChange(applyAccessPrefs);
onAudioPrefsChange(() => sfx.setVolumes(loadAudioPrefs()));
sfx.setVolumes(loadAudioPrefs());
session.access = loadAccessPrefs();
document.documentElement.dataset.motion = resolveMotion(session.access.motion, prefersReducedMotion());

/** Hover hints follow the (re-bindable) emote keys. */
function paintEmoteHints(): void {
  const keys = loadEmoteKeys();
  emoteBtn.title = keyLabel(keys.toggle);
  emoteBar.querySelectorAll<HTMLButtonElement>('button[data-emote]').forEach((b) => {
    b.title = keyLabel(keys.emotes[Number(b.dataset.emote)] ?? '');
  });
}
onEmoteKeysChange(paintEmoteHints);
paintEmoteHints();
emoteBtn.addEventListener('click', () => {
  emoteBar.hidden = !emoteBar.hidden;
  emoteBtn.setAttribute('aria-expanded', String(!emoteBar.hidden));
});
function closeEmoteBar(): void {
  emoteBar.hidden = true;
  emoteBtn.setAttribute('aria-expanded', 'false');
}
// outside click or Esc closes the bar
document.addEventListener('pointerdown', (e) => {
  if (!emoteBar.hidden && !emoteBar.contains(e.target as Node) && e.target !== emoteBtn) closeEmoteBar();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !emoteBar.hidden) closeEmoteBar();
  if (e.ctrlKey || e.metaKey || e.altKey || emoteBtn.hidden) return;
  const el = e.target as HTMLElement | null;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  // the toggle key opens the bar, then a reaction's key sends it (the toggle key again closes it)
  const keys = loadEmoteKeys();
  if (e.code === keys.toggle) {
    emoteBar.hidden = !emoteBar.hidden;
    emoteBtn.setAttribute('aria-expanded', String(!emoteBar.hidden));
  } else if (!emoteBar.hidden) {
    const i = keys.emotes.indexOf(e.code);
    if (i >= 0) {
      net.send({ t: 'EMOTE', emote: i });
      closeEmoteBar();
    }
  }
});
/** Emote controls exist while in a room (not in the away views). */
function updateEmoteButton(): void {
  const show = session.code !== '' && !ui.isAway();
  emoteBtn.hidden = !show;
  if (!show) emoteBar.hidden = true;
}
function showEmote(msg: Extract<ServerMessage, { t: 'EMOTE' }>): void {
  const pop = document.createElement('div');
  pop.className = 'emote-pop';
  pop.style.left = `${10 + Math.random() * 80}%`;
  pop.style.color = hex(session.colorOf(msg.from));
  const icon = document.createElement('span');
  icon.textContent = EMOTES[msg.emote] ?? '';
  pop.append(icon, document.createTextNode(msg.name));
  emoteFloat.append(pop);
  window.setTimeout(() => pop.remove(), 2300);
}
const pingEl = document.getElementById('hud-ping')!;
const pingBars = [1, 2, 3, 4].map(() => document.createElement('span'));
pingEl.replaceChildren(...pingBars);
const poorWatch = new PoorConnectionWatch();
let shownQuality = '';
/** Signal-bars indicator (hover for the exact ms) and a toast after a stretch of poor connection. */
function paintPing(): void {
  const q = qualityOf(net.rttMs);
  const key = `${q}:${Math.round(net.rttMs / 10)}`;
  if (key !== shownQuality) {
    shownQuality = key;
    const lit = barsOf(q);
    pingEl.dataset.q = q;
    pingEl.title = net.rttMs ? `${Math.round(net.rttMs)} ms` : '';
    pingBars.forEach((b, i) => b.classList.toggle('on', i < lit));
  }
  if (poorWatch.sample(q, performance.now())) ui.toast(t('net.poor'));
}
const input = new InputController(
  document.getElementById('joystick')!,
  document.getElementById('dash')!,
  () => session.phase,
  {
    onMenuButton: () => toggleMenu(),
    // lobby / results / final / how-to panels are menus too: the pad drives them like the in-game menu
    isMenuOpen: () => menuOpen || ui.isAway() || howToOpen || (session.phase !== 'countdown' && session.phase !== 'playing'),
    onMenuNav: (nav) => navigateMenu(nav),
  },
  document.getElementById('mine')!,
  () => loadControls(),
  document.getElementById('cross')!,
);
onControlsChange(() => input.refreshControls());

let lastResult: { game: string; placements: any[]; last: boolean; teams?: TeamResult[]; stage?: { n: number; of: number; target: number } } | null = null;
let lastScores: Record<string, number> = {};
let finalShown = false;

function resetMatchData(): void {
  lastResult = null;
  lastScores = {};
  finalShown = false;
}

// ---- room URL: `/room/ABCD` (player link) / `/room/ABCD?spectate=1` (watch link) ----
function setRoomUrl(code: string, spectator: boolean): void {
  replacePath(roomPath(code, spectator));
}
function clearRoomUrl(): void {
  replacePath('/');
}
function roomLink(spectator: boolean): string {
  // the password is part of the link on purpose: whoever gets the link can enter
  return `${linkOrigin()}${roomPath(session.code, spectator, session.password)}`;
}

/** What the user last asked for, so a busy room can fall back to spectating. */
let pending: { name: string; code?: string; spectate: boolean; password?: string } | null = null;
let leaving = false;

/** In-game menu (Esc / hamburger): leave, or ask the room to restart by vote. */
let menuOpen = false;
/** First-run "how to play" card on top of the countdown (kept across countdown -> playing until dismissed). */
let howToOpen = false;
function paintMuteButton(): void {
  const muted = sfx.isMuted();
  muteBtn.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', t(muted ? 'sound.unmute' : 'sound.mute'));
}
muteBtn.addEventListener('click', () => sfx.setMuted(!sfx.isMuted()));
sfx.onMuteChange(paintMuteButton);
function setMenuButton(visible: boolean): void {
  menuBtn.hidden = !visible;
  muteBtn.hidden = !visible;
  if (visible) paintMuteButton();
  if (!visible) menuOpen = false;
}
function closeMenu(): void {
  if (!menuOpen) return;
  menuOpen = false;
  render();
  menuBtn.focus({ preventScroll: true }); // give focus back to what opened the menu
}
function toggleMenu(): void {
  if (menuBtn.hidden) return;
  if (menuOpen) return closeMenu();
  menuOpen = true;
  sfx.play('click');
  setControls(false);
  ui.showGameMenu();
}
/** Gamepad navigation of the in-game menu dialog: d-pad moves focus, A clicks, B closes. */
function navigateMenu(nav: 'up' | 'down' | 'select' | 'back'): void {
  if (nav === 'back') {
    if (menuOpen) return closeMenu();
    if (ui.isAway()) return ui.returnToRoom();
    return;
  }
  const btns = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button:not(:disabled)')].filter((b) => !b.closest('[hidden]'));
  if (!btns.length) return;
  const i = btns.indexOf(document.activeElement as HTMLButtonElement);
  if (nav === 'select') return void (i >= 0 ? btns[i].click() : btns[0].focus());
  const next = i < 0 ? 0 : (i + (nav === 'down' ? 1 : -1) + btns.length) % btns.length;
  btns[next].focus();
}
menuBtn.addEventListener('click', toggleMenu);
// A suspended AudioContext (backgrounded tab, spectator who never hit unlock) resumes on the next gesture/visibility.
// (the context is created here, inside a real gesture, so a resumed seat after a reload is not silent)
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
window.addEventListener('touchstart', () => sfx.unlock(), { capture: true, passive: true });
window.addEventListener('keydown', () => sfx.unlock(), { capture: true });
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    hiddenAt = performance.now();
    return;
  }
  sfx.resume();
  // a phone that was locked or backgrounded may hold a dead socket: find out now, not at the next send
  if (!session.code || !hiddenAt) return;
  const away = performance.now() - hiddenAt;
  hiddenAt = 0;
  if (away < 3000) return;
  net.checkAlive();
  if (net.connected) ui.toast(t('toast.back'));
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleMenu();
});

function applyVote(vote: typeof session.vote): void {
  if (vote && !session.vote) sfx.play('alert');
  session.vote = vote;
  session.voteEndsAt = vote ? performance.now() + vote.left * 1000 : 0;
  ui.renderVote();
}

let reconnectEl: HTMLElement | null = null;
let reconnectText: HTMLElement | null = null;
function showReconnectOverlay(on: boolean, attempt = 0): void {
  if (!reconnectEl) {
    reconnectEl = document.createElement('div');
    reconnectEl.id = 'reconnect';
    reconnectText = document.createElement('span');
    reconnectText.setAttribute('role', 'status');
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'btn alt small';
    leave.textContent = t('reconnect.leave');
    leave.addEventListener('click', () => reconnect.leave());
    reconnectEl.append(reconnectText, leave);
    document.body.append(reconnectEl);
  }
  reconnectText!.textContent = attempt > 1 ? t('reconnect.attempt', { n: attempt }) : t('reconnect.trying');
  reconnectEl.querySelector('button')!.textContent = t('reconnect.leave');
  reconnectEl.hidden = !on;
}
/** A resume attempt in progress (unexpected drop, or a page reload with a stored token). */
const reconnect = createReconnectController({
  net,
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  showOverlay: showReconnectOverlay,
  onBeginInGame: () => {
    applyVote(null);
    setControls(false);
    setMenuButton(true);
  },
  onJoinAttempt: (info) => {
    pending = { name: info.name, code: info.code, spectate: info.spectate === true };
  },
  clearResume,
  showJoinLink: (code) => ui.showJoinLink(code),
  leaveToMenu: () => {
    resetToMenu();
    probeServer();
  },
  failToMenu: () => {
    resetToMenu(t('reconnect.failed'));
    probeServer();
  },
  spectateInstead: (info, code, message) => {
    pending = { name: info.name, code: info.code, spectate: true };
    net.join(info.name, info.code, undefined, true);
    ui.toast(t('toast.watchInstead', { message: errorText(code, message) }));
  },
  errorToMenu: (info, code, message) => {
    resetToMenu(code === 'ROOM_CLOSED' ? t('conn.closed') : code === 'ROOM_NOT_FOUND' ? t('conn.notFound', { code: info.code }) : errorText(code, message));
  },
});

function resetToMenu(message = ''): void {
  reconnect.stop();
  clearResume();
  applyVote(null);
  setMenuButton(false);
  music.stop();
  resetSession();
  updateEmoteButton();
  resetMatchData();
  scene.reset(false);
  setControls(false);
  if (tvMode) {
    // the screen always comes back to a room of its own
    replacePath('/tv');
    tvStatus(message || t('console.tvOpening'));
    tvRetryLater(message ? 5000 : 2000);
    return;
  }
  clearRoomUrl();
  ui.showMenu(message);
}

// ---- console mode: this browser is the TV (`/tv`) ----
let tvMode = false;
const tvStatusEl = document.createElement('div');
tvStatusEl.id = 'tv-status';
tvStatusEl.hidden = true;
document.body.append(tvStatusEl);
/** What the TV is doing while it has no room yet (opening, or why it cannot): never a blank screen. */
function tvStatus(text: string): void {
  tvStatusEl.textContent = text;
  tvStatusEl.hidden = text === '';
}
let tvRetry = 0;
function tvRetryLater(ms = 5000): void {
  window.clearTimeout(tvRetry);
  tvRetry = window.setTimeout(() => void connectScreen(), ms);
}
const tvPin = document.createElement('div');
tvPin.id = 'tv-pin';
tvPin.hidden = true;
document.body.append(tvPin);
let tvPinTimer = 0;

async function paintTvPin(): Promise<void> {
  const info = tvMode && session.code && session.phase === 'lobby' ? await screenInfo() : null;
  tvPin.hidden = !info;
  if (info) tvPin.textContent = t('console.tvHint', { url: `${linkOrigin()}/console`, pin: info.pin });
}

async function connectScreen(): Promise<void> {
  tvMode = true;
  document.body.classList.add('tv');
  net.screenMode = true;
  if (!tvPinTimer) tvPinTimer = window.setInterval(() => void paintTvPin(), 4000);
  ui.hide();
  tvStatus(t('console.tvOpening'));
  try {
    if (!net.connected) await net.connect();
    net.join(t('menu.spectator'));
  } catch {
    tvStatus(t('conn.unreachable'));
    tvRetryLater(3000);
  }
}

const connectThen = async (name: string, code?: string, selection?: GameSelection, spectate = false, password?: string, isPublic = false) => {
  sfx.unlock();
  pending = { name, code, spectate, ...(password ? { password } : {}) };
  ui.hide();
  try {
    if (!net.connected) await net.connect();
    net.join(name, code, selection, spectate, undefined, password, isPublic);
  } catch (e) {
    resetToMenu((e as Error).message);
  }
};

/** Label of the big action button, from the catalog's `action` metadata. */
function actionKey(id: string): MessageKey {
  return `action.${actionFor(id)}`;
}
/** the labels a pack asked for (see ClientGamePlugin.actionLabels), to repaint only when they change */
let actionHint = '';
function applyActionHint(labels: { a1: string; a2?: string } | undefined): void {
  const key = labels ? `${labels.a1}|${labels.a2 ?? ''}` : '';
  if (key === actionHint) return;
  actionHint = key;
  if (!labels) return setActionLabel(session.playingId);
  document.getElementById('dash')!.textContent = labels.a1;
  const mine = document.getElementById('mine')!;
  mine.hidden = !labels.a2;
  if (labels.a2) mine.textContent = labels.a2;
}

function setActionLabel(id: string): void {
  document.getElementById('dash')!.textContent = t(actionKey(id));
  // games with a secondary action (mines) get a second button
  const second = secondaryActionFor(id);
  const mine = document.getElementById('mine')!;
  mine.hidden = !second;
  if (second) mine.textContent = t(`action.${second}` as MessageKey);
}

const ui = new UI({
  onCreate: (name, selection, password, isPublic) => void connectThen(name, undefined, selection, false, password, isPublic),
  onJoin: (name, code) => {
    const c = normalizeRoomCode(cleanRoomCodeInput(code));
    if (!c) return ui.showMenu(t('menu.enterCode'));
    void connectThen(name, c);
  },
  onReady: (ready) => {
    sfx.play('click');
    net.send({ t: 'READY', ready });
  },
  onStart: (force = false) => {
    sfx.unlock();
    net.send(force ? { t: 'START_GAME', force: true } : { t: 'START_GAME' });
  },
  onNext: () => net.send({ t: 'NEXT_GAME' }),
  onBackToLobby: () => net.send({ t: 'BACK_TO_LOBBY' }),
  onVoteStart: (kind) => net.send({ t: 'VOTE_START', kind }),
  onVote: (yes) => net.send({ t: 'VOTE', yes }),
  onMenuClose: () => closeMenu(),
  rtt: () => net.rttMs,
  onHowToClose: () => {
    if (session.playingId) markHowToSeen(session.playingId);
    howToOpen = false;
    render();
  },
  onJoinLink: (name, code, password) => void connectThen(name, code, undefined, false, password),
  onConsoleControl: (code, token) => {
    net.consoleToken = token;
    void connectThen(t('menu.spectator'), code, undefined, true);
  },
  onWatch: (code, password) => void connectThen(t('menu.spectator'), code, undefined, true, password),
  onPromote: () => net.send({ t: 'JOIN_AS_PLAYER' }),
  onLeaveSeat: () => net.send({ t: 'LEAVE_SEAT' }),
  onSetRole: (id, spectator) => net.send({ t: 'SET_ROLE', id, spectator }),
  onKick: (id) => net.send({ t: 'KICK', id }),
  onMakeHost: (id) => net.send({ t: 'MAKE_HOST', id }),
  onResetName: (id) => net.send({ t: 'RESET_NAME', id }),
  onSettings: (s) => net.send({ t: 'ROOM_SETTINGS', ...s }),
  onReport: (id) => net.send({ t: 'REPORT', id }),
  onSetTeam: (team, id) => net.send({ t: 'SET_TEAM', team, ...(id ? { id } : {}) }),
  onSetSelection: (selection) => net.setSelection(selection),
  onLeave: () => {
    clearResume();
    clearLastRoom();
    if (reconnect.active || !net.connected) return resetToMenu('');
    leaving = true;
    net.disconnect();
  },
  onAway: (away) => {
    if (away) {
      // looking at another view: no game input or in-game menu until the player returns
      menuOpen = false;
      menuBtn.hidden = true;
      muteBtn.hidden = true;
      setControls(false);
      setWakeLock(false);
    } else render();
  },
  onCopy: (spectator) => {
    const link = roomLink(spectator);
    const done = () => ui.toast(spectator ? t('toast.watchCopied') : t('toast.inviteCopied'));
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(done, () => window.prompt(t('toast.copyPrompt'), link));
    } else {
      window.prompt(t('toast.copyPrompt'), link);
    }
  },
});

sfx.onBlocked = () => ui.toast(t('sound.blocked'));

let wantControls = false;
/** The running game's plugin may suggest a move control from its snapshot (e.g. a cross for grid movement). */
let moveHint: MoveControl | undefined;
/** latest public snapshot, to feed a pack's controller when its private state arrives */
let latestPublic: GameState | null = null;

/** Show the on-screen controls (touch screens always; others when the player enabled them) with the right move control. */
function applyControls(): void {
  const prefs = loadTouchPrefs();
  // a pack's own controller replaces the joystick and buttons
  controlsEl.hidden = !(wantControls && !session.spectator && !hasController() && resolveShowControls(prefs, isTouchDevice()));
  const game = gameIdOf(session.playingId);
  const kind = resolveMoveControl(prefs, game, moveHint);
  controlsEl.dataset.hand = prefs.hand;
  document.getElementById('controller')?.style.setProperty('--ctl-scale', String({ small: 0.8, medium: 1, large: 1.25 }[prefs.size]));
  controlsEl.style.setProperty('--ctl-scale', String({ small: 0.8, medium: 1, large: 1.25 }[prefs.size]));
  controlsEl.style.setProperty('--ctl-opacity', String(prefs.opacity / 100));
  const joy = document.getElementById('joystick')!;
  const cross = document.getElementById('cross')!;
  if (joy.hidden !== (kind !== 'joystick') || cross.hidden !== (kind !== 'cross')) input.releaseMove();
  joy.classList.toggle('floating', prefs.floating);
  joy.hidden = kind !== 'joystick';
  cross.hidden = kind !== 'cross';
}

function setControls(visible: boolean): void {
  wantControls = visible;
  if (!visible) {
    destroyController();
    destroyOverlay();
  }
  applyControls();
}
onTouchPrefsChange(applyControls);
window.addEventListener(
  'touchstart',
  () => {
    if (!isTouchDevice()) {
      _markTouchSeen();
      applyControls();
    }
  },
  { passive: true, once: true },
);

function showEndPanel(): void {
  const kind = endPanelFor(session.phase, !!lastResult, finalShown);
  if (kind === 'results' && lastResult) {
    ui.showResults(lastResult.game, lastResult.placements, lastScores, lastResult.last, lastResult.teams, lastResult.stage);
  } else if (kind === 'waiting-results') ui.showWaiting('results');
  else if (kind === 'waiting-finished') ui.showWaiting('finished');
}

/** Announce "Get ready", each whole second of the countdown, and "Go!" once per round (state packets repeat). */
let lastAnnounced = '';
function announceCountdown(phase: 'countdown' | 'playing', left: number): void {
  const key = phase === 'countdown' ? `c${Math.ceil(left)}` : 'go';
  if (key === lastAnnounced) return;
  const first = lastAnnounced === '' || lastAnnounced === 'go';
  lastAnnounced = key;
  if (phase === 'playing') return ui.announce(t('sr.go'));
  ui.announce(first ? t('sr.getReady') : t('sr.countdown', { n: Math.ceil(left) }));
}

function render(): void {
  if (ui.isAway()) return; // re-rendered by returnToRoom()
  menuOpen = false;
  // background music runs from the countdown to the end of the round, for games that have a track
  if (session.phase === 'countdown' || session.phase === 'playing') music.playFor(session.playingId);
  else music.stop();
  setWakeLock(session.phase === 'countdown' || session.phase === 'playing');
  updateEmoteButton();
  if (session.phase !== 'countdown' && session.phase !== 'playing') howToOpen = false;
  setMenuButton(session.phase === 'countdown' || session.phase === 'playing' || session.phase === 'results');
  switch (session.phase) {
    case 'lobby':
      session.playingId = '';
      // the host may cut a round short: nothing of it stays on screen
      destroyController();
      destroyOverlay();
      applyVote(null);
      scene.reset(false);
      setControls(false);
      ui.showLobby();
      break;
    case 'countdown':
    case 'playing':
      if (!howToOpen && session.phase === 'countdown' && !session.spectator && session.playingId && !hasSeenHowTo(session.playingId)) {
        howToOpen = true;
      }
      if (howToOpen) {
        ui.showHowTo(); // also after the in-game menu closed on top of it
        setControls(false);
      } else {
        ui.hide();
        setControls(true);
      }
      break;
    case 'results':
      setControls(false);
      showEndPanel();
      break;
    case 'finished':
      showEndPanel(); // MATCH_FINISHED replaces this with the final screen
      break;
  }
}

/** Localized text for a server error code, falling back to the server's message. */
function errorText(code: string, fallback: string, why: { reason?: string; minutes?: number } = {}): string {
  const key = `error.${code}` as MessageKey;
  const s = t(key);
  const base = s === key ? fallback : s;
  // operator-supplied reason and remaining ban time (BANNED / KICKED)
  return base + (why.reason ? `: ${why.reason}` : '') + (why.minutes ? ` (${t('error.minutesLeft', { n: why.minutes })})` : '');
}

// learn early what the operator switched off, so the first menu already hides it
setOnBrandChange(() => {
  document.title = brandName();
  ui.refreshBrand();
});
setOnMaintenanceChange(() => ui.refreshMaintenance());
void refreshDisabled();

net.onMessage = (msg: ServerMessage) => {
  switch (msg.t) {
    case 'WELCOME':
      resetSession(); // nothing of a previous room may leak into this one
      destroyController();
      destroyOverlay();
      latestPublic = null;
      resetMatchData();
      session.myId = msg.id;
      session.code = msg.code;
      session.config = msg.config;
      session.selection = msg.selection;
      session.spectator = msg.spectator;
      session.password = pending?.password ?? null; // the host is told the real one right after (ROOM_PASSWORD)
      session.passwordProtected = !!pending?.password;
      if (!tvMode) setRoomUrl(msg.code, msg.spectator);
      if (tvMode) tvStatus('');
      if (tvMode) void paintTvPin();
      if (!msg.spectator && pending) saveLastRoom({ code: msg.code, name: pending.name });
      if (tvMode) clearResume();
      else if (!msg.spectator && msg.resume && pending) saveResume({ code: msg.code, token: msg.resume, name: pending.name });
      else if (msg.spectator && pending?.code) saveResume({ code: msg.code, token: '', name: pending.name, spectate: true }); // a TV/watch screen comes back after a drop
      else clearResume();
      if (reconnect.active) {
        reconnect.stop();
        if (!msg.spectator) render();
      }
      if (msg.spectator) ui.toast(t('toast.watching'));
      else if (sfx.isMuted()) ui.toast(t('sound.muted'));
      break;
    case 'ROOM_UPDATE': {
      const phaseChanged = session.phase !== msg.phase;
      if (session.phase === 'lobby' && msg.phase === 'lobby' && session.players.length && msg.players.length !== session.players.length) {
        sfx.play(msg.players.length > session.players.length ? 'join' : 'click');
      }
      session.players = msg.players;
      session.hostId = msg.hostId;
      session.selection = msg.selection;
      session.spectators = msg.spectators;
      session.watchers = msg.watchers;
      session.locked = msg.locked;
      session.lateJoin = msg.lateJoin;
      session.catchUp = msg.catchUp;
      session.passwordProtected = msg.passwordProtected;
      if (!msg.passwordProtected) session.password = null;
      session.maxPlayers = msg.maxPlayers;
      session.ext = msg.ext ?? {};
      session.teams = msg.teams;
      session.teamSize = msg.teamSize ?? 0;
      session.phase = msg.phase;
      if (phaseChanged || msg.phase === 'lobby') render();
      break;
    }
    case 'ROOM_PASSWORD':
      session.password = msg.password;
      if (session.phase === 'lobby') render();
      break;
    case 'GAME_START':
      session.playingId = msg.game.id;
      moveHint = undefined;
      actionHint = '';
      destroyController();
      destroyOverlay();
      latestPublic = null;
      setActionLabel(msg.game.id);
      finalShown = false;
      ui.toast(t('game.firstTo', { n: msg.roundsToWin, round: msg.round }));
      sfx.play('start');
      scene.reset(true, session.config?.networkRate);
      // an installed game's code loads now (the countdown gives it time); its music starts once it is in
      {
        const started = msg.game.id;
        loadPlugin(started).then(
          () => {
            if (session.playingId === started && (session.phase === 'countdown' || session.phase === 'playing')) music.playFor(started);
          },
          () => ui.toast(t('game.loadFailed', { name: msg.game.name })),
        );
      }
      break;
    case 'GAME_STATE':
      announceCountdown(msg.phase, msg.countdown);
      scene.pushSnapshot({ state: msg.state, phase: msg.phase, countdown: msg.countdown });
      latestPublic = msg.state;
      applyActionHint(pluginForKind(msg.state.kind)?.actionLabels?.(msg.state, context));
      if (wantControls) {
        syncOverlay(msg.state);
        if (syncController(msg.state, session.spectator)) applyControls();
      }
      {
        const hint = pluginForKind(msg.state.kind)?.moveControl?.(msg.state);
        if (hint !== moveHint) {
          moveHint = hint;
          applyControls();
        }
      }
      break;
    case 'GAME_PRIVATE':
      if (!session.spectator) privateController(msg.data, latestPublic);
      break;
    case 'GAME_EVENT':
      for (const e of msg.events) {
        if ((e.kind === 'hit' || e.kind === 'eliminated') && e.id === session.myId) {
          vibrate(e.kind, loadTouchPrefs().haptics);
        }
        if (e.kind !== 'eliminated') continue;
        const name = session.players.find((p) => p.id === e.id)?.name;
        if (e.id === session.myId) ui.announce(t('sr.youEliminated'));
        else if (name) ui.announce(t('sr.eliminated', { name }));
      }
      scene.handleEvents(msg.events);
      break;
    case 'EMOTE':
      showEmote(msg);
      break;
    case 'GAME_RESULT':
      lastResult = { game: msg.game.name, placements: msg.placements, last: msg.last, teams: msg.teams, stage: msg.stage };
      sfx.play(msg.placements.some((p) => p.id === session.myId && p.place === 1) || session.spectator ? 'win' : 'lose');
      {
        const first = msg.placements.find((p) => p.place === 1);
        if (first) ui.announce(first.id === session.myId ? t('sr.youWon') : t('sr.roundWinner', { name: first.name }));
      }
      break;
    case 'SCORE_UPDATE':
      lastScores = msg.scores;
      render();
      break;
    case 'VOTE_UPDATE':
      applyVote(msg.vote);
      if (msg.outcome) {
        ui.toast(t(voteOutcomeKey(msg.outcome, msg.kind)));
        if (msg.outcome === 'passed' && menuOpen) closeMenu();
      }
      break;
    case 'MATCH_FINISHED':
      setMenuButton(false);
      applyVote(null);
      scene.reset(false);
      setControls(false);
      sfx.play('win');
      finalShown = true;
      ui.showFinal(msg.ranking, msg.teams, msg.mvp, msg.rounds);
      if (msg.ranking[0]) ui.announce(t('sr.matchWinner', { name: msg.ranking[0].name }));
      break;
    case 'MAINTENANCE_STATE':
      setMaintenance(parseMaintenance(msg));
      break;
    case 'NOTICE':
      ui.toast(
        msg.code === 'IDLE_CLOSING'
          ? t('notice.idleClosing', { n: msg.seconds ?? 60 })
          : msg.code === 'SERVER_RESTARTING'
            ? t('notice.restarting')
            : msg.code === 'HOST_CHANGED'
              ? msg.id === session.myId
                ? t('notice.youAreHost')
                : t('notice.hostChanged', { name: msg.name ?? '' })
              : msg.code === 'BACK_TO_LOBBY'
                ? t('notice.backToLobby')
                : msg.code === 'SELECTION_RESET'
                ? t('notice.selectionReset')
                : msg.code === 'SEAT_EXPIRED'
                  ? t('notice.seatExpired')
                  : msg.message,
      );
      break;
    case 'ERROR':
      if (reconnect.handleError(msg.code, msg.message)) break;
      sfx.play('hazard');
      const text = errorText(msg.code, msg.message, { reason: msg.reason, minutes: msg.minutes });
      if (msg.code === 'KICKED' || msg.code === 'BANNED') removed = true; // the socket closes right after: do not treat it as a drop
      if (tvMode && !session.code) {
        // the screen could not open its room: say why on the TV and try again
        tvStatus(msg.code === 'BAD_STATE' ? t('console.tvOff') : text);
        tvRetryLater();
        break;
      }
      const action = errorAction(msg.code, pending, session.code);
      if (action.kind === 'reset-menu') {
        resetToMenu(action.key === 'conn.closed' ? t('conn.closed') : t('conn.notFound', action.params));
      } else if (action.kind === 'spectate-fallback' && pending?.code) {
        pending = { ...pending, spectate: true };
        net.join(pending.name, pending.code, undefined, true, undefined, pending.password);
        ui.toast(t('toast.watchInstead', { message: text }));
      } else if (action.kind === 'ask-password' && pending?.code) {
        // not entered yet: ask for the password on the join panel (a wrong one says so)
        ui.showJoinLink(pending.code, action.wrong ? text : '', true, pending.password ?? '');
      } else if (action.kind === 'reset-menu-text') {
        resetToMenu(text);
      } else {
        ui.toast(text);
      }
      break;
  }
};

/** After an unexpected disconnect (e.g. the dev server restarted) tell the user when it is back. */
let probing = false;
function probeServer(): void {
  if (probing) return;
  probing = true;
  let tries = 0;
  const tick = async () => {
    tries++;
    try {
      const res = await fetch('/stats', { cache: 'no-store' });
      if (res.ok) {
        probing = false;
        ui.toast(t('toast.serverBack'));
        return;
      }
    } catch {
      /* still down */
    }
    if (net.connected || tries > 180) probing = false;
    else window.setTimeout(tick, 1000);
  };
  window.setTimeout(tick, 1000);
}

let removed = false;
net.onClose = () => {
  if (removed) {
    removed = false;
    return;
  }
  const wasLeaving = leaving;
  leaving = false;
  if (wasLeaving) return resetToMenu('');
  if (reconnect.active) return reconnect.onClose(); // dropped again mid-attempt
  const stored = session.code ? loadResume() : null;
  if (stored && stored.code === session.code) return reconnect.begin(stored, false);
  // rooms live in the server's memory: a restart (or crash) drops them
  resetToMenu(t('conn.disconnected'));
  probeServer();
};

// ---- input pump: send intentions at ~30 Hz, only when they change ----------
let last = { mx: 0, my: 0, a1: false, a2: false };
let lastSentAt = 0;
let seq = 0;
setInterval(() => {
  if (!net.connected) return;
  paintPing();
  if (session.spectator) return;
  if (session.phase !== 'playing' && session.phase !== 'countdown') return;
  const s = input.sample();
  const now = performance.now();
  const changed = s.mx !== last.mx || s.my !== last.my || s.a1 !== last.a1 || s.a2 !== last.a2;
  if (changed || now - lastSentAt > 250) {
    net.send({ t: 'INPUT', seq: seq++, mx: s.mx, my: s.my, a1: s.a1, a2: s.a2 });
    last = s;
    lastSentAt = now;
  }
}, 33);

// Opened from a recovery link (#recover=<key>, or one a plugin handles, like #transfer=<code>)? Adopt that profile, then land on it.
if (recoveryHashes().includes(/^#([a-z0-9-]+)=/.exec(location.hash)?.[1] ?? '')) {
  const link = location.hash;
  history.replaceState(null, '', location.pathname + location.search); // keep the secret out of history
  void applyRecoveryInput(link).then((ok) => {
    if (ok) location.replace(profilePath());
    else ui.toast(t('profile.importBad'));
  });
}

// Opened from a shared link? Offer to join / watch that room instead of the main menu.
{
  const route = parseLocation(location.pathname, location.search);
  if (route.view === 'room') {
    replacePath(roomPath(route.code, route.spectate)); // also upgrades an old `/?room=` link
    const stored = startupResume(loadResume(), route.code, route.spectate);
    if (route.spectate) void connectThen(t('menu.spectator'), route.code, undefined, true, route.password);
    else if (stored) reconnect.begin(stored, true);
    else ui.showJoinLink(route.code, '', !!route.password, route.password);
  } else if (route.view === 'tv') void connectScreen();
  else if (route.view === 'console') ui.showConsole();
  else if (route.view === 'profile') ui.showProfile();
  else {
    const screen = pluginScreenAt(location.pathname); // a page a plugin draws, like /leaderboard
    if (screen) ui.showPluginScreen(screen.id);
    else ui.showMenu();
  }
}

// Static page text and the action button follow the language.
function applyStaticText(): void {
  document.title = brandName();
  menuBtn.setAttribute('aria-label', t('menu.menu'));
  emoteBtn.setAttribute('aria-label', t('emote.title'));
  document.getElementById('spec-rank')?.setAttribute('aria-label', t('spectate.rank'));
  document.getElementById('spec-prev')?.setAttribute('aria-label', t('spectate.prev'));
  document.getElementById('spec-next')?.setAttribute('aria-label', t('spectate.next'));
  paintMuteButton();
  actionHint = ''; // a pack's labels are repainted by the next snapshot, in the new language
  setActionLabel(session.playingId);
  ui.renderVote(); // rebuilds the banner from session.vote/voteEndsAt, countdown intact
}
applyStaticText();
onLangChange(applyStaticText);

// The language lives in the profile: follow it on load, and save later changes back.
if (cachedProfile() && !isGuest()) {
  fetchProfile(loadProfileKey()).then((rec) => {
    applyProfileLang(rec);
    adoptProfileControls(rec); // keys saved in the profile follow the player to this browser
    adoptProfileTouchPrefs(rec);
    adoptProfileEmoteKeys(rec);
    adoptProfileAccessPrefs(rec);
    adoptProfileAudioPrefs(rec);
    input.refreshControls();
  }, () => {});
}
onLangChange((lang) => persistLang(lang));
