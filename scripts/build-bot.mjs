// Bundles the bot server (dist/bot-main.js + dist/bot-worker.js, one worker thread per bot).
//   BOT_GAMES=all   (default) the AI of every built-in game is compiled in
//   BOT_GAMES=none  bare bundle: no built-in AI; the AIs come from the game packs found in BOT_GAMES_DIR
//   BOT_OUT_DIR     output folder (default dist)
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.env.BOT_GAMES || 'all';
if (mode !== 'all' && mode !== 'none') {
  console.error(`unknown BOT_GAMES: ${mode} (all or none)`);
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const games = resolve(root, 'bot/games/index.ts');
const none = resolve(root, 'bot/games/none.ts');

await build({
  entryPoints: [resolve(root, 'bot/server/main.ts'), resolve(root, 'bot/server/worker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  packages: 'external',
  entryNames: 'bot-[name]',
  outdir: resolve(root, process.env.BOT_OUT_DIR || 'dist'),
  plugins:
    mode === 'none'
      ? [
          {
            name: 'bare-bot',
            setup(b) {
              b.onResolve({ filter: /(^|\/)games$/ }, (args) => {
                const target = resolve(args.resolveDir, args.path);
                return target === resolve(root, 'bot/games') || target === games ? { path: none } : undefined;
              });
            },
          },
        ]
      : [],
});
console.log(`bot server built (${mode === 'none' ? 'bare: no built-in game AI' : 'full'})`);
