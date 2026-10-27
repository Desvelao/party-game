/**
 * Character models on the client. Their slots come with the games and plugins lists at boot (registered in the
 * shared registry); how each is drawn comes with its owner's `client.mjs`: plugins are imported at boot, a game pack
 * only when needed (`ensureModel`). A model whose code is missing is drawn as a plain body in the player's colour.
 */
import { characterModel, type CharacterDraw, type CharacterModel, type Shape } from '../../../shared';
import { loadPlugin } from './registry';

const draws = new Map<string, CharacterDraw>();

/** The draw functions an owner's client code exports (`characters`), for the models it registered. */
export function registerDraws(owner: CharacterModel['owner'], fns: Record<string, unknown> | undefined): void {
  for (const [id, fn] of Object.entries(fns ?? {})) {
    const model = characterModel(id);
    if (typeof fn === 'function' && model && model.owner.kind === owner.kind && model.owner.id === owner.id) draws.set(id, fn as CharacterDraw);
  }
}

/** Import the code that draws `id` when a game pack owns it; resolves once it is known (or failed: the fallback is used). */
export async function ensureModel(id: string): Promise<void> {
  const model = characterModel(id);
  if (!model || draws.has(id) || model.owner.kind !== 'game') return;
  try {
    await loadPlugin(model.owner.id);
  } catch {
    /* drawn with the fallback */
  }
}

/** The shapes of a character, or a plain body when its model or code is unknown. */
export function characterShapes(modelId: string | undefined, look: Record<string, number>, color: number, r: number, facing: number): Shape[] {
  const draw = modelId ? draws.get(modelId) : undefined;
  if (draw) {
    try {
      const shapes = draw(look, color, r, facing);
      if (Array.isArray(shapes) && shapes.length > 0) return shapes;
    } catch {
      /* a broken model must not break the frame */
    }
  }
  return [{ k: 'circle', x: 0, y: 0, r, fill: color }];
}

/** For tests. */
export function resetDraws(): void {
  draws.clear();
}
