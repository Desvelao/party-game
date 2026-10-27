// AIs shipped by installed game packs (the `ai` export of a pack's server.mjs), for games the bot tools do not know by source.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GameAi } from '../../src/core/shared/ai';
import { loadPack } from '../../src/core/server/plugins/pack';
import { registerGame } from '../core/registry';

/** Register the AI of every verified pack found in `dirs` (each holds one folder per pack). Returns the ids registered. */
export async function loadPackAis(dirs: string[], log: (line: string) => void = () => {}): Promise<string[]> {
  const found: string[] = [];
  for (const root of dirs.map((d) => resolve(d))) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        const dir = join(root, entry.name);
        loadPack(dir); // integrity first: the code only runs when the pack verifies
        const mod = (await import(pathToFileURL(join(dir, 'server.mjs')).href)) as { default?: { ai?: GameAi } };
        const ai = mod.default?.ai;
        if (ai && typeof ai.create === 'function') {
          registerGame(ai);
          found.push(ai.id);
          log(`AI from pack ${ai.id}`);
        }
      } catch (err) {
        log(`skipped pack ${entry.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  }
  return found;
}
