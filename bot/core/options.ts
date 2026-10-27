import { optionsFor, type OptionDef } from '../../src/core/shared/catalog';

/** Game the bot tools create or play when none is given. */
export const DEFAULT_BOT_GAME = 'ballistix';

export type OptionValue = number | boolean | string;

/** Parse a `--opt key=value` string by the option's declared type; without a definition, guess from the text. */
export function coerceCliOption(def: OptionDef | undefined, raw: string): OptionValue {
  if (def?.type === 'choice') return raw;
  if (def?.type === 'boolean') return raw === 'true';
  if (def?.type === 'number') return Number(raw);
  return raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
}

/** `--opt` pairs to a game's options; the catalog must have the games registered to know the option types. */
export function coerceCliOptions(pairs: [string, string][], game: string, variant?: string): Record<string, OptionValue> {
  const defs = optionsFor(game, variant ?? 'all');
  const out: Record<string, OptionValue> = {};
  for (const [k, v] of pairs) out[k] = coerceCliOption(defs.find((d) => d.id === k), v);
  return out;
}
