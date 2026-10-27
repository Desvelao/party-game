// Registry of per-variant adapters. An unknown variant (or variantAware 0) gets the Spring Painter one (the baseline).
import { POGO_VARIANTS } from '../../server/config';
import type { Rules, VariantAdapter } from './types';

const rulesOf = (id: string): Rules => {
  const c = (POGO_VARIANTS.find((v) => v.id === id) ?? POGO_VARIANTS[0]).config;
  return { scoreBy: c.scoreBy, fillEnclosed: c.fillEnclosed, fourWayMissile: c.fourWayMissile, beam: c.beam, bomber: c.bomber, padlock: c.padlock, selfWipe: c.selfWipe, steal: c.steal, mushrooms: c.mushrooms };
};

export const ADAPTERS: Record<string, () => VariantAdapter> = {
  // Spring Painter: crates bank, mushrooms stun; the baseline values cover it
  'spring-painter': () => ({ rules: rulesOf('spring-painter') }),
  // Spring Rush: closing a loop banks everything you own; no crates. Four-way missiles and the beam.
  'spring-rush': () => ({ rules: rulesOf('spring-rush') }),
  // Spring Madness: loops fill (no bank), Blast Bot drops TNT, fires missiles in from the edge and leaves 4-way arrows
  'spring-madness': () => ({ rules: rulesOf('spring-madness'), itemBonus: { arrow: 2 } }),
  // Spring Lock: landing on your own colour wipes it; the padlock protects it; a missile hit steals the victim's squares
  'spring-lock': () => ({ rules: rulesOf('spring-lock'), itemBonus: { padlock: 4, missile: 3 } }),
};

export const createAdapter = (variant: string, aware = true): VariantAdapter => (aware ? ADAPTERS[variant] : undefined)?.() ?? ADAPTERS['spring-painter']();
export type { Rules, VariantAdapter } from './types';
