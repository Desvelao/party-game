import type { OptionValue } from '../../../../core/shared/catalog';
import { BallArena } from '../core/BallArena';
import type { ModuleFactory } from '../core/module';
import { applyCoreOptions } from '../core/options';
import { MagnetModule, applyMagnetOptions, sandOrb } from './sandOrb';
import type { VariantConfig } from './config';
import { smashball } from './smashball';
import { EnemyModule, applyEnemyOptions, pulseBall } from './pulseBall';
import { RepelModule, applyRepelOptions } from './repel';
import { EnginesModule, applyEngineOptions, cloudOrbs } from './cloudOrbs';

export type { VariantConfig } from './config';

/**
 * Registry of Ballistix variants, in the order a match rotates through them.
 * A variant is a config (core numbers + the sections of the modules it uses);
 * the modules themselves are picked from those sections below.
 */
export const VARIANTS: VariantConfig[] = [smashball, sandOrb, pulseBall, cloudOrbs];

/** Modules a config asks for. Add new variant features here (and in config.ts). */
function modulesFor(cfg: VariantConfig): ModuleFactory {
  return (api) => [
    ...(cfg.magnet ? [new MagnetModule(api, cfg.magnet)] : []),
    ...(cfg.enemy ? [new EnemyModule(api, cfg.enemy)] : []),
    ...(cfg.repel ? [new RepelModule(api, cfg.repel)] : []),
    ...(cfg.engines ? [new EnginesModule(api, cfg.engines)] : []),
  ];
}

/**
 * Apply validated host options to a variant config: first the core options,
 * then each module's own. Unknown ids are ignored.
 */
export function applyOptions(base: VariantConfig, options: Record<string, OptionValue>): VariantConfig {
  const cfg: VariantConfig = {
    ...base,
    spawn: { ...base.spawn },
    reinforce: { ...base.reinforce },
    ...(base.magnet ? { magnet: { ...base.magnet } } : {}),
    ...(base.enemy ? { enemy: { ...base.enemy } } : {}),
    ...(base.repel ? { repel: { ...base.repel } } : {}),
    ...(base.engines ? { engines: { ...base.engines } } : {}),
  };
  applyCoreOptions(cfg, options);
  applyMagnetOptions(cfg, options);
  applyEnemyOptions(cfg, options);
  applyRepelOptions(cfg, options);
  applyEngineOptions(cfg, options);
  return cfg;
}

/** Build a round for a (possibly option-adjusted) variant config. */
export function createBallArena(cfg: VariantConfig, seed?: number): BallArena {
  return new BallArena(cfg, modulesFor(cfg), seed);
}
