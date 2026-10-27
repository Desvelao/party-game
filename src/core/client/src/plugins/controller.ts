import type { GameState } from '../../../shared';
import type { ControllerHandle } from './api';
import { context, pluginForKind } from './registry';

let handle: ControllerHandle | null = null;
let keepControls = false;
let layer: ControllerHandle | null = null;
let priv: unknown = null;

const host = () => document.getElementById('controller');

/** True while a pack's own controls are on screen and they replace the core's joystick and buttons. */
export const hasController = (): boolean => handle !== null && !keepControls;

/** Mount the pack's controller on the first snapshot of its game; keep it fed afterwards. Returns true when it was just mounted. */
export function syncController(state: GameState, spectator: boolean): boolean {
  const el = host();
  if (!el || spectator) return false;
  let mounted = false;
  if (!handle) {
    const plugin = pluginForKind(state.kind);
    const make = plugin?.controller;
    if (!make) return false;
    keepControls = plugin.controllerKeepsControls === true;
    if (keepControls) el.dataset.keep = '1';
    el.hidden = false;
    handle = make(el, context);
    mounted = true;
  }
  handle.update(state, priv);
  return mounted;
}

/** The server sent this player's private state. */
export function privateController(data: unknown, pub: GameState | null): void {
  priv = data;
  handle?.update(pub, priv);
}

/** The game is over (or the room changed): drop the controller and anything private. Returns true when one was mounted. */
export function destroyController(): boolean {
  priv = null;
  const had = handle !== null;
  handle?.destroy();
  handle = null;
  keepControls = false;
  const el = host();
  if (el) {
    delete el.dataset.keep;
    el.hidden = true;
    el.textContent = '';
  }
  return had;
}

/** Mount the pack's overlay (for everyone) on the first snapshot of its game and keep it fed. */
export function syncOverlay(state: GameState): void {
  const el = document.getElementById('overlay');
  if (!el) return;
  if (!layer) {
    const make = pluginForKind(state.kind)?.overlay;
    if (!make) return;
    el.hidden = false;
    layer = make(el, context);
  }
  layer.update(state, null);
}

export function destroyOverlay(): void {
  layer?.destroy();
  layer = null;
  const el = document.getElementById('overlay');
  if (el) {
    el.hidden = true;
    el.textContent = '';
  }
}
