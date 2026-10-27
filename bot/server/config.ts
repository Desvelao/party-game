// Entry points for building the companion's configuration (see settings.ts for the schema and the rules).
import { ConfigError, defaultConfig, loadConfigFile, parseArgs, resolveConfig, resolveConfigPath, type CompanionConfig, type Resolved, type ResolvedConfigPath } from './settings';

export { wsUrl, validateConfig, type CompanionConfig } from './settings';

/** Fresh defaults (a new object each time, so editing it never touches another config). */
export const DEFAULTS: CompanionConfig = defaultConfig();

export interface Loaded extends Resolved {
  file: ResolvedConfigPath | null;
}

/** argv (after the script name) + environment -> effective configuration. Throws ConfigError. */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv = process.env): Loaded {
  const args = parseArgs(argv);
  const file = resolveConfigPath(args, env);
  const values = file ? loadConfigFile(file.path) : null;
  return { ...resolveConfig(args, values, env), file };
}

export { ConfigError };
