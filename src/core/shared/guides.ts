/**
 * Player-facing guide of a game or variant: objective, a few rules, optional items. Each game ships its
 * guides in its own game.json (`catalog.guide`); the core only knows the shape. Item and character names
 * (Shadow Bear, berry...) are kept as in the game.
 */
import type { Localized } from './i18n';

export interface GuideItem {
  name: Localized;
  description: Localized;
}

export interface Guide {
  objective: Localized;
  rules: Localized[];
  items?: GuideItem[];
}
