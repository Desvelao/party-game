import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/build-bot.mjs: the full bot bundle compiles every built-in game AI in, the bare one (BOT_GAMES=none) none.
const dirs: string[] = [];
const build = (games: string): { main: string; worker: string } => {
  const out = mkdtempSync(join(tmpdir(), 'bot-build-'));
  dirs.push(out);
  execFileSync(process.execPath, ['scripts/build-bot.mjs'], { env: { ...process.env, BOT_GAMES: games, BOT_OUT_DIR: out }, stdio: 'pipe' });
  return { main: readFileSync(join(out, 'bot-main.js'), 'utf8'), worker: readFileSync(join(out, 'bot-worker.js'), 'utf8') };
};

afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('bot server bundle', () => {
  it('full has the built-in AIs, bare has none but still loads pack AIs', () => {
    const full = build('all');
    const bare = build('none');
    expect(full.worker).toContain('sprint-smash');
    expect(bare.worker).not.toContain('sprint-smash');
    expect(bare.worker.length).toBeLessThan(full.worker.length / 2);
    // both load the AI of installed packs (BOT_GAMES_DIR), in the process and in every bot thread
    for (const b of [full, bare]) {
      expect(b.main).toContain('BOT_GAMES_DIR');
      expect(b.worker).toContain('BOT_GAMES_DIR');
    }
  }, 60_000);

  it('rejects an unknown BOT_GAMES', () => {
    expect(() => execFileSync(process.execPath, ['scripts/build-bot.mjs'], { env: { ...process.env, BOT_GAMES: 'some' }, stdio: 'pipe' })).toThrow();
  });
});
