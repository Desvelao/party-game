import { backoffMs, resumeErrorAction, shouldGiveUp, type ResumeInfo } from './reconnect';

/** Everything the controller needs from the outside world (injected so it can be tested with fake timers). */
export interface ReconnectDeps {
  net: {
    readonly connected: boolean;
    connect(): Promise<void>;
    disconnect(): void;
    join(name: string, code: string, selection: undefined, spectate: boolean, token: string): void;
  };
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  /** `attempt` (1-based) is given while a resume try is in flight, so the overlay can show progress. */
  showOverlay(on: boolean, attempt?: number): void;
  /** A non-startup attempt begins: drop vote/controls, show the in-game menu button. */
  onBeginInGame(): void;
  /** An attempt is about to send JOIN for `info` (so a failure can be traced back to it). */
  onJoinAttempt(info: ResumeInfo): void;
  clearResume(): void;
  showJoinLink(code: string): void;
  /** The player chose to stop waiting: back to the menu. */
  leaveToMenu(): void;
  /** Give up: back to the menu with a message, then probe the server. */
  failToMenu(): void;
  /** Server said ROOM_BUSY / ROOM_FULL while resuming: fall back to spectating. */
  spectateInstead(info: ResumeInfo, code: string, message: string): void;
  /** Any other ERROR while resuming: back to the menu. */
  errorToMenu(info: ResumeInfo, code: string, message: string): void;
}

interface Attempt {
  info: ResumeInfo;
  startedAt: number;
  attempt: number;
  timer?: number;
  startup: boolean;
}

/** State machine + timers of the resume flow (see reconnect.ts for the pure helpers). */
export function createReconnectController(deps: ReconnectDeps) {
  let current: Attempt | null = null;

  function stop(): void {
    if (current && current.timer !== undefined) deps.clearTimeout(current.timer);
    current = null;
    deps.showOverlay(false);
  }

  function attempt(): void {
    const r = current;
    if (!r) return;
    if (shouldGiveUp(r.attempt, deps.now() - r.startedAt, r.startup ? 3 : undefined)) return failed();
    const delay = r.attempt === 0 ? 0 : backoffMs(r.attempt - 1);
    r.timer = deps.setTimeout(async () => {
      if (current !== r) return;
      r.attempt++;
      deps.showOverlay(true, r.attempt);
      try {
        if (!deps.net.connected) await deps.net.connect();
        if (current !== r) return deps.net.disconnect(); // left mid-connect: don't leave an orphan socket
        deps.onJoinAttempt(r.info);
        deps.net.join(r.info.name, r.info.code, undefined, r.info.spectate === true, r.info.token);
        // WELCOME ends the attempt (stop()); a socket close before that schedules the next one (onClose)
      } catch {
        attempt();
      }
    }, delay);
  }

  function failed(): void {
    const startup = current?.startup;
    const code = current?.info.code ?? '';
    stop();
    deps.clearResume();
    if (startup && code) {
      deps.showJoinLink(code);
      return;
    }
    deps.failToMenu();
  }

  /** The player pressed Leave on the overlay: stop trying and return to the menu. */
  function leave(): void {
    if (!current) return;
    stop();
    deps.net.disconnect();
    deps.leaveToMenu();
  }

  function begin(info: ResumeInfo, startup: boolean): void {
    current = { info, startedAt: deps.now(), attempt: 0, startup };
    if (!startup) deps.onBeginInGame();
    deps.showOverlay(true);
    attempt();
  }

  /** ERROR received while an attempt is in flight. Returns false when no attempt is active. */
  function handleError(code: string, message: string): boolean {
    const r = current;
    if (!r) return false;
    const how = resumeErrorAction(code, r.startup);
    if (how === 'spectate') {
      stop();
      deps.clearResume();
      deps.spectateInstead(r.info, code, message);
    } else if (how === 'give-up') {
      failed();
    } else {
      deps.errorToMenu(r.info, code, message);
    }
    return true;
  }

  return {
    get active(): boolean {
      return current !== null;
    },
    begin,
    stop,
    leave,
    failed,
    handleError,
    /** The socket closed mid-attempt: schedule the next one. */
    onClose: attempt,
  };
}
