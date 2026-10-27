// Registry of per-variant adapters. An unknown variant gets the Desert Fox one (the baseline).
import * as desertFox from './desertFox';
import * as jungleFox from './jungleFox';
import * as metalFox from './metalFox';
import * as swampFox from './swampFox';
import type { Physics, VariantAdapter } from './types';

export const ADAPTERS: Record<string, { physics: Physics; create: () => VariantAdapter }> = {
  'desert-fox': desertFox,
  'metal-fox': metalFox,
  'jungle-fox': jungleFox,
  'swamp-fox': swampFox,
};

const entry = (variant: string) => ADAPTERS[variant] ?? desertFox;
export const physicsFor = (variant: string): Physics => entry(variant).physics;
export const createAdapter = (variant: string): VariantAdapter => entry(variant).create();
export type { Physics, VariantAdapter } from './types';
