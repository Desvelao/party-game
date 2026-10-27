import type { OptionValue } from '../../../../core/shared/catalog';
import type { CoreConfig } from './config';

export type Options = Record<string, OptionValue>;

/** Reads a numeric option, clamped to [lo, hi]; undefined when absent / not a number. */
export function numberOption(options: Options) {
  return (id: string, lo: number, hi: number): number | undefined => {
    const v = options[id];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  };
}

/**
 * Apply the validated host options that belong to the core rules. Values are
 * re-clamped here so a bad catalog entry can't produce an unplayable or
 * tunnelling ball. Unknown ids are ignored (variants read their own).
 */
export function applyCoreOptions<T extends CoreConfig>(cfg: T, options: Options): T {
  const num = numberOption(options);
  cfg.lives = Math.round(num('lives', 1, 15) ?? cfg.lives);
  const balls = options.balls;
  if (typeof balls === 'string' && balls !== 'auto') {
    const n = Math.min(4, Math.max(1, Number.parseInt(balls, 10) || 1));
    cfg.startBalls = () => n;
  }
  cfg.ballMaxSpeed = num('ballMaxSpeed', 150, 900) ?? cfg.ballMaxSpeed;
  cfg.ballSpeed = Math.min(cfg.ballMaxSpeed, num('ballSpeed', 150, 700) ?? cfg.ballSpeed);
  cfg.ballMinSpeed = Math.min(cfg.ballMinSpeed, cfg.ballSpeed * 0.8);
  cfg.hitGain = num('hitGain', 1, 1.3) ?? cfg.hitGain;
  if (typeof options.smashEnabled === 'boolean') cfg.smashEnabled = options.smashEnabled;
  if (typeof options.ballCollisions === 'boolean') cfg.ballCollisions = options.ballCollisions;
  cfg.smashGain = num('smashGain', 1, 2.5) ?? cfg.smashGain;
  cfg.smashCooldown = num('smashCooldown', 0.5, 5) ?? cfg.smashCooldown;
  cfg.smashRadius = num('smashRadius', 60, 400) ?? cfg.smashRadius;
  cfg.paddleLen = num('paddleLen', 60, 260) ?? cfg.paddleLen;
  cfg.spawn.delay = num('spawnDelay', 0.5, 8) ?? cfg.spawn.delay;
  cfg.spawn.variance = num('spawnDelayVariance', 0, 4) ?? cfg.spawn.variance;
  cfg.timeLimit = num('timeLimit', 30, 300) ?? cfg.timeLimit;
  cfg.reinforce.every = num('ballSpawnEvery', 3, 60) ?? cfg.reinforce.every;
  cfg.reinforce.variance = num('ballSpawnVariance', 0, 30) ?? cfg.reinforce.variance;
  cfg.reinforce.max = Math.round(num('maxBalls', 0, 16) ?? cfg.reinforce.max);
  return cfg;
}
