// Bot for `npm run balance`: on its turn it presses and releases A in turn, and each press plays the selected card.
// (The engine reads presses, not holds. The selected card is the first of the hand, aimed at the first rival.)
import type { GameState, InputState } from '../../../core/shared/types';
import type { CardsState } from '../shared/types';

const pressed = new Map<string, boolean>();

export function greedyCards(state: GameState, id: string): InputState {
  const s = state as CardsState;
  if (s.turn !== id) {
    pressed.set(id, false);
    return { mx: 0, my: 0, a1: false, a2: false };
  }
  const down = !pressed.get(id);
  pressed.set(id, down);
  return { mx: 0, my: 0, a1: down, a2: false };
}
