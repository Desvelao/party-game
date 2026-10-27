// Registry of per-variant adapters. An unknown variant gets the Frost Shove one (the baseline).
import * as wildFrenzy from './wildFrenzy';
import * as thawFrenzy from './thawFrenzy';
import * as frostClassic from './frostClassic';
import * as frostFrenzy from './frostFrenzy';
import * as tipTumble from './tipTumble';
import type { Physics, VariantAdapter } from './types';

export const ADAPTERS: Record<string, { physics: Physics; create: () => VariantAdapter }> = {
  'frost-classic': frostClassic,
  'frost-frenzy': frostFrenzy,
  'tip-tumble': tipTumble,
  'thaw-frenzy': thawFrenzy,
  'wild-frenzy': wildFrenzy,
};

const entry = (variant: string) => ADAPTERS[variant] ?? frostClassic;

export const physicsFor = (variant: string): Physics => entry(variant).physics;
/** a fresh adapter per bot and round: adapters may keep their own state */
export const createAdapter = (variant: string): VariantAdapter => entry(variant).create();
export type { Physics, VariantAdapter } from './types';
