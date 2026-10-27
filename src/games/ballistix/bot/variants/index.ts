// Registry of per-variant adapters. An unknown variant gets the smash ball one (the baseline).
import * as sandOrb from './sandOrb';
import * as smashball from './smashball';
import * as pulseBall from './pulseBall';
import * as cloudOrbs from './cloudOrbs';
import type { Physics, VariantAdapter } from './types';

const BY_ID: Record<string, { physics: Physics; create: () => VariantAdapter }> = {
  smashball,
  'sand-orb': sandOrb,
  'pulse-ball': pulseBall,
  'cloud-orbs': cloudOrbs,
};

const entry = (variant: string) => BY_ID[variant] ?? smashball;

export const physicsFor = (variant: string): Physics => entry(variant).physics;
/** a fresh adapter per bot and round: adapters keep their own state */
export const createAdapter = (variant: string): VariantAdapter => entry(variant).create();
export type { Physics, VariantAdapter } from './types';
