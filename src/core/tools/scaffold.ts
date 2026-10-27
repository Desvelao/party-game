/**
 * Dev tool for game authors: scaffold a game pack or add a variant to one.
 *   npm run scaffold -- game <id> [--name "My Game"] [--out src/games]
 *   npm run scaffold -- variant <gameId> <variantId> [--name "My Variant"] [--action act] [--out src/games]
 * `game` is `gamepack init` (server + config + test stub, shared types, client, AGENTS.md, game.json with the guide and all
 * translations). `variant` appends a catalog variant to the pack's game.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACTION_KINDS, ID_RE, LANGS } from '../shared';
import { UsageError, flagValue, parseArgs } from './args';
import { initGame } from './gamepack';

export const USAGE = `usage:
  scaffold game <id> [--name "My Game"] [--out src/games]     create src/games/<id> from the template
  scaffold variant <gameId> <variantId> [--name "My Variant"] [--action ${ACTION_KINDS.join('|')}] [--out src/games]
                                                              add a variant (catalog entry, guide and texts) to src/games/<gameId>/game.json`;

const titleCase = (id: string) => id.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** The same English text in every language: the author translates it (the manifest check asks for the keys). */
const localized = (en: string): Record<string, string> => Object.fromEntries(LANGS.map((l) => [l, en]));

/** Append a variant to `<out>/<gameId>/game.json`. Returns the manifest path and the texts still to translate. */
export function addVariant(gameId: string, variantId: string, name: string, action: string, outRoot: string): { file: string; todo: string[] } {
  if (!ID_RE.test(variantId) || variantId.length < 2 || variantId.length > 32) throw new UsageError('the variant id must be lowercase letters, digits and dashes (2-32 characters)');
  if (!(ACTION_KINDS as readonly string[]).includes(action)) throw new UsageError(`--action must be one of ${ACTION_KINDS.join(', ')}`);
  const file = join(resolve(outRoot), gameId, 'game.json');
  if (!existsSync(file)) throw new UsageError(`${file} does not exist (create the game with "scaffold game ${gameId}")`);
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { catalog: { variants?: { id: string }[] } };
  const variants = (manifest.catalog.variants ??= []);
  if (variants.some((v) => v.id === variantId)) throw new UsageError(`${gameId} already has a variant "${variantId}"`);
  const description = `What ${name} changes in ${titleCase(gameId)}.`;
  const objective = `Win a round of ${name}.`;
  const rule = `Describe how ${name} plays.`;
  variants.push({
    id: variantId,
    name,
    description,
    action,
    guide: { objective: localized(objective), rules: [localized(rule)] },
    options: [],
  } as (typeof variants)[number]);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return { file, todo: [description, objective, rule] };
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ['name', 'out', 'action']);
  const [cmd, target, variantId] = args.words;
  if (args.flags.has('help') || !cmd) {
    console.log(USAGE);
    return cmd ? 0 : 2;
  }
  const out = flagValue(args, 'out') ?? 'src/games';
  switch (cmd) {
    case 'game': {
      if (!target) throw new UsageError('game needs an id');
      const dir = initGame(target, flagValue(args, 'name') ?? titleCase(target), out);
      console.log(`created ${relative(process.cwd(), dir)}\nnext: edit server/index.ts and game.json, then npm run gamepack -- validate ${relative(process.cwd(), dir)}`);
      return 0;
    }
    case 'variant': {
      if (!target || !variantId) throw new UsageError('variant needs a game id and a variant id');
      const { file, todo } = addVariant(target, variantId, flagValue(args, 'name') ?? titleCase(variantId), flagValue(args, 'action') ?? 'act', out);
      console.log(`added "${variantId}" to ${relative(process.cwd(), file)}`);
      console.log('next: make server createMinigame(playableId) handle the new id, write the texts in the guide (all languages) and the locales,');
      console.log('      and, if the pack has a bot, add its adapter in bot/variants/ and bot/scenarios/ladder-' + variantId + '.json (repo AGENTS.md rule 6).');
      console.log(`texts to write: ${todo.map((s) => `"${s}"`).join(', ')}`);
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${cmd}"`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UsageError) {
        console.error(`${err.message}\n\n${USAGE}`);
        process.exit(2);
      }
      console.error(err);
      process.exit(1);
    },
  );
}
