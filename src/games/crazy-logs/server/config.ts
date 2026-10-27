import type { OptionDef, OptionValue } from '../../../core/shared/catalog';
import manifest from '../game.json';

/** The host's Advanced options live in game.json; their defaults are the server's defaults. */
const OPTIONS = manifest.catalog.options as OptionDef[];
const defaultOptions = (defs: OptionDef[]): Record<string, OptionValue> => Object.fromEntries(defs.map((d) => [d.id, d.default]));

/** Tunable rules of Crazy Logs; the host's Advanced options (game.json) map onto these. */
export interface CrazyLogsConfig {
  /** round length, s */
  timeLimit: number;
  /** surface-speed change for a landing at the very edge of a log, u/s */
  landImpulse: number;
  /** surface-speed change for standing at the very edge of a log, u/s^2 */
  standTorque: number;
  /** fastest surface speed; never more than the walk speed so a rider can always resist */
  maxSpin: number;
  /** 1/s decay of the spin */
  spinFade: number;
  /** time in the water before restarting at the start bank, s */
  respawnTime: number;
  /** +- seconds of random variation of that */
  respawnVariance: number;
  hopDistance: number;
  /** logs across the river */
  logCount: number;
  /** thickness of a log */
  logSize: number;
  /** water jets event on */
  jets: boolean;
  /** knock-back speed of a jet, u/s */
  jetForce: number;
  /** mean seconds between jets */
  jetInterval: number;
  /** +- seconds of random variation of that */
  jetVariance: number;
}

export const DEFAULT_CONFIG: CrazyLogsConfig = {
  timeLimit: 60,
  landImpulse: 120,
  standTorque: 110,
  maxSpin: 190,
  spinFade: 0.7,
  respawnTime: 1.2,
  respawnVariance: 0,
  hopDistance: 100,
  logCount: 6,
  logSize: 64,
  jets: false,
  jetForce: 300,
  jetInterval: 8,
  jetVariance: 3,
};

/** `stability` 50 is the built-in behaviour; 100 freezes the logs, 0 doubles how much they react. */
export const stabilityScale = (stability: number): number => Math.max(0, (100 - stability) / 50);

/** Config for validated option values (missing / unknown ids fall back to the defaults). */
export function applyOptions(options: Record<string, OptionValue>): CrazyLogsConfig {
  const o = { ...defaultOptions(OPTIONS), ...options };
  const num = (id: string, fallback: number) => (typeof o[id] === 'number' ? (o[id] as number) : fallback);
  const scale = stabilityScale(num('stability', 50));
  return {
    timeLimit: num('timeLimit', DEFAULT_CONFIG.timeLimit),
    landImpulse: DEFAULT_CONFIG.landImpulse * scale,
    standTorque: DEFAULT_CONFIG.standTorque * scale,
    maxSpin: num('maxSpin', DEFAULT_CONFIG.maxSpin),
    spinFade: num('spinFade', DEFAULT_CONFIG.spinFade),
    respawnTime: num('respawnTime', DEFAULT_CONFIG.respawnTime),
    respawnVariance: num('respawnVariance', DEFAULT_CONFIG.respawnVariance),
    hopDistance: num('hopDistance', DEFAULT_CONFIG.hopDistance),
    logCount: num('logCount', DEFAULT_CONFIG.logCount),
    logSize: num('logSize', DEFAULT_CONFIG.logSize),
    jets: typeof o.jets === 'boolean' ? o.jets : DEFAULT_CONFIG.jets,
    jetForce: num('jetForce', DEFAULT_CONFIG.jetForce),
    jetInterval: num('jetInterval', DEFAULT_CONFIG.jetInterval),
    jetVariance: num('jetVariance', DEFAULT_CONFIG.jetVariance),
  };
}
