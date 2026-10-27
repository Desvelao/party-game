// Registry of per-variant adapters. An unknown variant (or variantAware 0) gets the Dot Sprint one (the baseline).
// Dot Sprint: open track edges (only the top outer arc is a wall), the berry bar and straight missiles fired with a2. Toxic Sprint: barrels on the outer edge, the slime monster's blobs, star pick-ups (a
// shock around you). Ember Sprint: open edges, berry bar, straight missiles (the Dot Sprint adapter) and the volcano's lava balls. Splash Sprint: the rods and the jump.
import { DASH_VARIANTS } from '../../server/config';
import * as dotSprint from './dotSprint';
import * as splashSprint from './splashSprint';
import type { Rules, VariantAdapter } from './types';

const rulesOf = (id: string): Rules => {
  const c = (DASH_VARIANTS.find((v) => v.id === id) ?? DASH_VARIANTS[0]).config;
  return { missiles: c.missiles, toxic: c.toxic, volcano: c.volcano, rods: c.rods, rodSpeed: c.rodSpeed, edgeWalls: c.edgeWalls, outerArc: c.outerArc, berryBar: c.berryBar, straightMissiles: c.straightMissiles, item2: c.item2 };
};

export const ADAPTERS: Record<string, () => VariantAdapter> = {
  'dot-sprint': () => dotSprint.create(rulesOf('dot-sprint')),
  'toxic-sprint': () => ({ rules: rulesOf('toxic-sprint') }),
  'ember-sprint': () => dotSprint.create(rulesOf('ember-sprint')),
  'splash-sprint': () => splashSprint.create(rulesOf('splash-sprint')),
};

export const createAdapter = (variant: string, aware = true): VariantAdapter => (aware ? ADAPTERS[variant] : undefined)?.() ?? ADAPTERS['dot-sprint']();
export type { Rules, VariantAdapter } from './types';
