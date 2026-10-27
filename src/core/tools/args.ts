/** Minimal argv parser shared by the games tools: `--name value`, `--name=value`, `--flag`, `--` ends options. */
export class UsageError extends Error {}

export interface Parsed {
  words: string[];
  flags: Map<string, string | true>;
}

/** `valueFlags` are the options that take a value; every other `--x` is a boolean flag. */
export function parseArgs(argv: string[], valueFlags: readonly string[] = []): Parsed {
  const words: string[] = [];
  const flags = new Map<string, string | true>();
  let optionsEnded = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (optionsEnded) words.push(a);
    else if (a === '--') optionsEnded = true;
    else if (a === '-h') flags.set('help', true);
    else if (a.startsWith('--') && a.length > 2) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (inline !== undefined) flags.set(name, inline);
      else if (valueFlags.includes(name)) {
        const v = argv[++i];
        if (v === undefined) throw new UsageError(`--${name} needs a value`);
        flags.set(name, v);
      } else flags.set(name, true);
    } else words.push(a);
  }
  return { words, flags };
}

export const flagValue = (p: Parsed, name: string): string | undefined => {
  const v = p.flags.get(name);
  return typeof v === 'string' ? v : undefined;
};
