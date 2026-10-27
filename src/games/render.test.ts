/**
 * Smoke test of every game's client half without a browser: plays real rounds on the server side and feeds the
 * snapshots to the game's renderer, HUD, ranking, cue and event hooks with a recording stand-in for Phaser.
 * It catches a renderer that reaches for something the plugin context does not give it.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClientContext, ClientGamePlugin } from '../core/client/src/plugins/api';
import { playablesOf } from '../core/shared/catalog';
import type { ServerGamePlugin } from '../core/shared/plugin-api';
import { sourceManifests } from '../core/server/plugins/sourceGames';
import type { GameEvent, GameState } from '../core/shared/types';

/** a Graphics / Text stand-in: every method exists and returns the same object, so chained calls work */
const sink: unknown = new Proxy(function () {}, {
  get: (_t, prop) => (prop === 'then' ? undefined : sink),
  apply: () => sink,
});

const ctx: ClientContext = {
  t: (key) => key,
  tr: (s) => s,
  loc: (l) => l.en,
  variantName: (id) => id,
  myId: () => 'p0',
  colorOf: () => 0x44aaff,
  labelOf: (id) => id,
  drawCharacter: () => {},
  motion: () => 1,
  lerp: (a, b, k) => a + (b - a) * k,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  sfx: () => {},
  sound: () => {},
  big: () => {},
  send: () => {},
};

const fx = { burst: () => {}, shake: () => {} };
const gamesDir = join(__dirname);

describe.each(sourceManifests().map((m) => m.id))('client of %s', (id) => {
  const manifest = sourceManifests().find((m) => m.id === id)!;

  it.each(playablesOf(manifest.catalog).map((p) => p.id))('draws %s from live snapshots', async (playableId) => {
    const server = ((await import(join(gamesDir, id, 'server', 'index.ts'))) as { default: ServerGamePlugin }).default;
    const client = ((await import(join(gamesDir, id, 'client', 'index.ts'))) as { default: ClientGamePlugin }).default;
    let seed = 7;
    const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const game = server.createMinigame(playableId, {}, rng);
    game.init([0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}` })));
    const renderer = client.createRenderer(ctx);
    const host = { g: sink, label: () => sink } as never;
    let prev: GameState | null = null;
    for (let tick = 0; tick < 240 && !game.isFinished(); tick++) {
      for (const p of ['p0', 'p1', 'p2']) game.handleInput(p, { mx: tick % 40 < 20 ? 1 : -1, my: Math.sin(tick / 30), a1: tick % 50 === 0, a2: tick % 90 === 0 });
      game.update(1 / 60);
      if (tick % 3) continue;
      const state = game.getState();
      expect(client.kinds).toContain(state.kind);
      renderer.render(host, prev ?? state, state, state, 0.5);
      client.hud?.(state, ctx);
      client.cue?.(state, 'playing', ctx);
      client.ranking?.(state, ctx);
      client.moveControl?.(state);
      client.actionLabels?.(state, ctx);
      const events: GameEvent[] = game.drainEvents();
      for (const e of events) {
        client.event?.(e, fx, ctx);
        if (e.kind === 'eliminated') renderer.markFallen?.(e.id);
      }
      prev = state;
    }
    renderer.reset?.();
    expect(readdirSync(join(gamesDir, id))).toContain('client');
  });
});
