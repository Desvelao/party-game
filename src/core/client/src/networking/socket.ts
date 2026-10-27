import { isGuest, loadProfileKey } from '../profile';
import { PROTOCOL_VERSION, t, type ClientMessage, type GameSelection, type ServerMessage } from '../../../shared';

type Handler = (msg: ServerMessage) => void;

/** Wire form of a selection: a playlist carries only its rounds, anything else game/variant/options. */
function selectionFields(selection: GameSelection): Record<string, unknown> {
  if (selection.playlist?.length) {
    return { playlist: selection.playlist, ...(selection.playlistRoundsToWin !== undefined ? { playlistRoundsToWin: selection.playlistRoundsToWin } : {}) };
  }
  return {
    game: selection.game,
    variant: selection.variant,
    ...(Object.keys(selection.options).length ? { options: selection.options } : {}),
  };
}

export class Net {
  private ws: WebSocket | null = null;
  private pingTimer: number | undefined;
  /** Whether the current socket ever reached OPEN (a failed first connect is not a drop). */
  private opened = false;
  rttMs = 0;
  private lastPongAt = 0;
  onMessage: Handler = () => {};
  onClose: () => void = () => {};

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const prev = this.ws;
      if (prev) {
        // detach first so the stale socket's close can't clobber this.ws/pingTimer or fire onClose
        prev.onopen = prev.onerror = prev.onmessage = prev.onclose = null;
        window.clearInterval(this.pingTimer);
        prev.close();
      }
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      this.opened = false;
      ws.onopen = () => {
        this.opened = true;
        this.pingTimer = window.setInterval(() => this.send({ t: 'PING', ts: performance.now() }), 2000);
        resolve();
      };
      ws.onerror = () => reject(new Error(t('conn.unreachable')));
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.t === 'PONG') {
          this.rttMs = performance.now() - msg.ts;
          this.lastPongAt = performance.now();
        }
        this.onMessage(msg);
      };
      ws.onclose = (ev) => {
        console.info(`[net] socket closed code=${ev.code} reason="${ev.reason}" clean=${ev.wasClean}`);
        window.clearInterval(this.pingTimer);
        this.ws = null;
        // never opened: connect() rejects (via onerror/here) and the caller shows that error
        if (!this.opened) return reject(new Error(t('conn.unreachable')));
        this.opened = false;
        this.onClose();
      };
    });
  }

  /** console mode: this socket is the TV screen (it opens the room it owns instead of joining one) */
  screenMode = false;
  /** console mode: token of a phone paired with the TV; a watching join carries it to take the host role */
  consoleToken = '';

  /** `selection` only applies when creating a room (no code). */
  join(name: string, code?: string, selection?: GameSelection, spectate = false, resume?: string, password?: string, isPublic = false): void {
    if (this.screenMode) {
      this.send({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name, screen: true } as ClientMessage);
      return;
    }
    this.send({
      t: 'JOIN_ROOM',
      v: PROTOCOL_VERSION,
      name,
      code,
      ...(spectate && code ? { spectate: true } : {}),
      ...(spectate && code && this.consoleToken ? { console: this.consoleToken } : {}),
      ...(!spectate && code && !resume ? { spectateIfBusy: true } : {}),
      ...(resume && code ? { resume } : {}),
      ...(password ? { password } : {}),
      ...(isPublic && !code ? { public: true } : {}),
      ...(isGuest() ? {} : { profileKey: loadProfileKey() }),
      ...(selection && !code ? selectionFields(selection) : {}),
    } as ClientMessage);
  }

  /** Host only: change the room's game / variant / options in the lobby. */
  setSelection(selection: GameSelection): void {
    this.send({ t: 'SET_SELECTION', ...selectionFields(selection) } as unknown as ClientMessage);
  }

  /**
   * After the tab comes back from the background: mobile browsers can sit on a dead socket for a
   * long time before reporting the close. Ping now; if nothing answers in `timeoutMs`, treat the
   * connection as dropped so the reconnect flow starts at once.
   */
  checkAlive(timeoutMs = 2500): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const sentAt = performance.now();
    this.send({ t: 'PING', ts: sentAt });
    setTimeout(() => {
      if (this.ws !== ws || this.lastPongAt >= sentAt) return;
      window.clearInterval(this.pingTimer);
      ws.onopen = ws.onerror = ws.onmessage = ws.onclose = null;
      ws.close();
      this.ws = null;
      this.opened = false;
      this.onClose();
    }, timeoutMs);
  }

  /** Close the connection on purpose (the caller handles the UI). */
  disconnect(): void {
    this.ws?.close();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
