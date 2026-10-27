// Server half of Rumble Cards: a turn-based card duel. The core owns lobby, countdown, scoring and networking.
import type { ServerGamePlugin } from '../../../core/shared/plugin-api';
import { RumbleCards } from './RumbleCards';
import { greedyCards } from './bot';
import { applyOptions } from './config';
import { rumbleCards } from '../bot';

const plugin: ServerGamePlugin = {
  createMinigame: (_playableId, options, rng) => new RumbleCards(applyOptions(options), rng),
  bot: greedyCards,
  ai: rumbleCards,
};
export default plugin;
