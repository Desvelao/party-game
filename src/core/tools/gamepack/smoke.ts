/**
 * Headless check of a pack's server code, the way the core would run it: every playable, with 2
 * and up to 4 random-input players, until the round ends. Catches the mistakes that would otherwise
 * show up in a live room: placements that miss a player, snapshots that are not plain JSON or grow
 * huge, rounds that never end, and updates too slow for a Raspberry Pi Zero.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultOptions, playablesOf, type CatalogGame, type ServerGamePlugin } from '../../shared';
import { writePackDir, type VerifiedPack } from '../../server/plugins/pack';

export const TICK_HZ = 30;
const MAX_SECONDS = 600;
/** Largest snapshot accepted; they are sent to every client every network tick. */
export const MAX_STATE_BYTES = 16 * 1024;
const WARN_STATE_BYTES = 6 * 1024;
const MAX_UPDATE_MS = 10;
const WARN_UPDATE_MS = 2;

export interface SmokeResult {
  errors: string[];
  warnings: string[];
  /** one line per run, for the report */
  runs: string[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function optionDefs(g: CatalogGame, playableId: string) {
  const v = g.variants.find((x) => x.id === playableId);
  const merged = new Map((g.options ?? []).map((o) => [o.id, o]));
  for (const o of v?.options ?? []) merged.set(o.id, o);
  return [...merged.values()];
}

export async function smokeTest(pack: VerifiedPack): Promise<SmokeResult> {
  const out: SmokeResult = { errors: [], warnings: [], runs: [] };
  const dir = mkdtempSync(join(tmpdir(), 'pgsmoke-'));
  try {
    writePackDir(pack.files, dir);
    const mod = (await import(pathToFileURL(join(dir, 'server.mjs')).href)) as { default?: ServerGamePlugin };
    const plugin = mod.default;
    if (!plugin || typeof plugin.createMinigame !== 'function') {
      out.errors.push('server.mjs must export default { createMinigame }');
      return out;
    }
    const cat = pack.manifest.catalog;
    const maxPlayers = cat.maxPlayers ?? 4;
    for (const p of playablesOf(cat)) {
      const v = cat.variants.find((x) => x.id === p.id);
      const limit = v?.maxPlayers ?? cat.maxPlayers ?? 4;
      for (const n of new Set([2, Math.max(2, Math.min(4, limit, maxPlayers))])) {
        runOne(plugin, p.id, defaultOptions(optionDefs(cat, p.id)), n, out);
      }
    }
    if (plugin.ai) checkAi(plugin, pack.manifest.id, cat, out);
  } catch (err) {
    out.errors.push(`could not load server.mjs: ${(err as Error).message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

const MAX_DECIDE_MS = 5;

/** The pack's AI: well-formed, and able to play a short round against a random opponent without crashing or stalling. */
function checkAi(plugin: ServerGamePlugin, packId: string, cat: CatalogGame, out: SmokeResult): void {
  const ai = plugin.ai!;
  const fail = (msg: string): void => void out.errors.push(`ai: ${msg}`);
  if (ai.id !== packId) return fail(`ai.id "${ai.id}" must equal the pack id "${packId}"`);
  if (!ai.kind.startsWith('ext:')) return fail(`ai.kind must start with "ext:" (got ${ai.kind})`);
  if (!ai.policies.includes(ai.defaultPolicy)) return fail(`defaultPolicy "${ai.defaultPolicy}" is not in policies`);
  if (typeof ai.create !== 'function') return fail('ai.create must be a function');
  const first = playablesOf(cat)[0];
  if (!first) return;
  const levels = [undefined, ...Object.keys(ai.levels ?? {})];
  const rng = mulberry32(99);
  for (const level of levels) {
    const label = `ai${level ? ` (${level})` : ''}`;
    try {
      const mg = plugin.createMinigame(first.id, defaultOptions(optionDefs(cat, first.id)), rng);
      mg.init([{ id: 'p1', name: 'AI' }, { id: 'p2', name: 'Other' }]);
      const brain = ai.create({ selfId: 'p1', name: 'AI', tickRate: TICK_HZ, networkRate: 15, seed: 7, params: { ...ai.defaultParams, ...(level ? ai.levels![level] : {}) } }, ai.defaultPolicy);
      let worst = 0;
      for (let t = 0; t < 20 * TICK_HZ && !mg.isFinished(); t++) {
        if (t % 2 === 0) mg.handleInput('p2', { mx: rng() * 2 - 1, my: rng() * 2 - 1, a1: rng() < 0.1, a2: false });
        mg.update(1 / TICK_HZ);
        if (t % 2 === 0) {
          brain.onState(JSON.parse(JSON.stringify(mg.getState())), { tick: t, phase: 'playing', recvMs: t * (1000 / TICK_HZ) });
          brain.onEvents(mg.drainEvents());
          const t0 = performance.now();
          const input = brain.decide(t * (1000 / TICK_HZ));
          worst = Math.max(worst, performance.now() - t0);
          if (!Number.isFinite(input.mx) || !Number.isFinite(input.my)) return fail(`${label}: decide() returned a non-finite move`);
          mg.handleInput('p1', input);
        }
      }
      if (worst > MAX_DECIDE_MS) fail(`${label}: decide() took ${worst.toFixed(1)} ms; the limit is ${MAX_DECIDE_MS} ms (it runs on the game server)`);
    } catch (err) {
      return fail(`${label}: crashed (${(err as Error).stack?.split('\n')[1]?.trim() ?? (err as Error).message})`);
    }
  }
  out.runs.push(`ai ${ai.id}: ${levels.length} level${levels.length === 1 ? '' : 's'} played`);
}

const MAX_PRIVATE_BYTES = 2048;

/** a random small object of the shapes a hostile or buggy client could send */
function fuzzAction(rng: () => number): Record<string, unknown> {
  const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)];
  return { a: pick(['play', 'end', 'x', '', 5, null]), c: pick([0, 1, 2, -1, 99, 1.5, 'a', null]), tg: pick(['p1', 'p2', 'nobody', 7, null]), n: rng() };
}

function runOne(plugin: ServerGamePlugin, id: string, options: Record<string, number | boolean | string>, n: number, out: SmokeResult): void {
  const label = `${id} x${n}`;
  const fail = (msg: string): void => void out.errors.push(`${label}: ${msg}`);
  const rng = mulberry32(1234 + n);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
  let mg;
  try {
    mg = plugin.createMinigame(id, options, rng);
    mg.init(players);
  } catch (err) {
    return fail(`could not start (${(err as Error).message})`);
  }
  const dt = 1 / TICK_HZ;
  const maxTicks = MAX_SECONDS * TICK_HZ;
  let ticks = 0;
  let maxBytes = 0;
  let totalMs = 0;
  let worstMs = 0;
  try {
    for (; ticks < maxTicks && !mg.isFinished(); ticks++) {
      if (ticks % 3 === 0) {
        for (const p of players) {
          if (n > 2 && p.id === `p${n}` && ticks >= 60) continue; // the last player leaves at tick 60
          mg.handleInput(p.id, { mx: rng() * 2 - 1, my: rng() * 2 - 1, a1: rng() < 0.15, a2: rng() < 0.05 });
        }
      }
      if (ticks % 7 === 0) {
        // game-defined messages: junk must be ignored, and private state has to stay small and plain JSON
        for (const p of players) {
          mg.handleAction?.(p.id, fuzzAction(rng));
          if (mg.getPrivateState) {
            const priv = JSON.stringify(mg.getPrivateState(p.id) ?? null);
            if (priv.length > MAX_PRIVATE_BYTES) return fail(`private state of ${p.id} is ${priv.length} bytes; the limit is ${MAX_PRIVATE_BYTES}`);
          }
        }
      }
      if (n > 2 && ticks === 60) mg.removePlayer(`p${n}`);
      if (n > 2 && ticks === 90) mg.addPlayer?.(players.find((p) => p.id === `p${n}`)!);
      const t0 = performance.now();
      mg.update(dt);
      const ms = performance.now() - t0;
      totalMs += ms;
      if (ms > worstMs) worstMs = ms;
      if (ticks % 5 === 0) {
        const state = mg.getState();
        const json = JSON.stringify(state);
        if (typeof state.kind !== 'string' || !state.kind.startsWith('ext:')) return fail(`state.kind must start with "ext:" (got ${String(state.kind)})`);
        if (typeof state.t !== 'number') return fail('state.t must be a number (seconds since the round started)');
        maxBytes = Math.max(maxBytes, json.length);
        const events = mg.drainEvents();
        if (!Array.isArray(events)) return fail('drainEvents() must return an array');
        JSON.stringify(events);
      }
    }
  } catch (err) {
    return fail(`crashed after ${ticks} ticks (${(err as Error).stack?.split('\n')[1]?.trim() ?? (err as Error).message})`);
  }
  if (!mg.isFinished()) return fail(`the round did not end within ${MAX_SECONDS} s of game time`);
  const placements = mg.getPlacements();
  const seen = new Set<string>();
  for (const pl of placements) {
    if (!players.some((p) => p.id === pl.id)) fail(`placement for unknown player "${pl.id}"`);
    else if (seen.has(pl.id)) fail(`player ${pl.id} placed twice`);
    seen.add(pl.id);
    if (!Number.isInteger(pl.place) || pl.place < 1) fail(`player ${pl.id} has place ${pl.place}; places are whole numbers from 1`);
  }
  for (const p of players) if (!seen.has(p.id)) fail(`player ${p.id} is missing from the placements${n > 2 && p.id === `p${n}` ? ' (a player who left must still be placed)' : ''}`);
  const stats = mg.getStats?.();
  if (stats) {
    const bad = Object.values(stats).some((o) => Object.values(o).some((v) => typeof v !== 'number' || !Number.isFinite(v)));
    if (bad || JSON.stringify(stats).length > MAX_STATE_BYTES) fail('getStats() must return small objects of finite numbers per player id');
  }
  if (maxBytes > MAX_STATE_BYTES) fail(`a snapshot is ${maxBytes} bytes; the limit is ${MAX_STATE_BYTES}`);
  else if (maxBytes > WARN_STATE_BYTES) out.warnings.push(`${label}: snapshots reach ${maxBytes} bytes; they go to every client every network tick`);
  const mean = ticks > 0 ? totalMs / ticks : 0;
  if (mean > MAX_UPDATE_MS) fail(`update() takes ${mean.toFixed(2)} ms on average; the limit is ${MAX_UPDATE_MS} ms`);
  else if (mean > WARN_UPDATE_MS) out.warnings.push(`${label}: update() takes ${mean.toFixed(2)} ms on average; a Pi Zero is about 10x slower than most PCs`);
  out.runs.push(`${label}: ${(ticks / TICK_HZ).toFixed(1)} s, ${maxBytes} B/snapshot, update ${mean.toFixed(3)} ms avg / ${worstMs.toFixed(2)} ms worst`);
}
