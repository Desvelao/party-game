// Registry of per-variant adapters. An unknown variant (or variantAware 0) gets the Jungle Bonanza one (the baseline).
// Jungle Bonanza: nitro (touching it blows up). Space Bonanza: blasts leave holes (falling in is out), power-ups.
// Snow Bonanza: ice (low grip), the penguin, power-ups. Drain Bonanza: no nitro, weak locked crates, ? crates with weapons.
import { CRATE_VARIANTS } from '../../server/config';
import type { Rules, VariantAdapter } from './types';

const rulesOf = (id: string): Rules => {
  const c = (CRATE_VARIANTS.find((v) => v.id === id) ?? CRATE_VARIANTS[0]).config;
  return { floorHoles: c.floorHoles, slippery: c.slippery, penguin: c.penguin, powerups: c.powerups, nitro: c.nitro, lockedCrates: c.lockedCrates, qboxes: c.qboxes };
};

export const ADAPTERS: Record<string, () => VariantAdapter> = {
  'jungle-bonanza': () => ({ rules: rulesOf('jungle-bonanza') }),
  'space-bonanza': () => ({ rules: rulesOf('space-bonanza') }),
  'snow-bonanza': () => ({ rules: rulesOf('snow-bonanza') }),
  'drain-bonanza': () => ({ rules: rulesOf('drain-bonanza') }),
};

export const createAdapter = (variant: string, aware = true): VariantAdapter => (aware ? ADAPTERS[variant] : undefined)?.() ?? ADAPTERS['jungle-bonanza']();
export type { Rules, VariantAdapter } from './types';
