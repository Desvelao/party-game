import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COUNTDOWN_SECONDS } from '../src/core/shared';
import { seededIds } from '../src/core/server/minigames';
import { registerSourceGames } from '../src/core/server/plugins/sourceGames';
import { seatNames, validateScenario, type Scenario } from './arena';
import { runOfflineRoom } from './offline';
import './games';

const sc: Scenario = { name: 'offline-test', game: 'ballistix', variant: 'smashball', options: { lives: 2, timeLimit: 30, roundsToWin: 1 }, seats: [{ bot: 'easy' }, { bot: 'semigod' }], matches: 1, rooms: 2 };
const dirs: string[] = [];

async function run(seed: number) {
  const dir = mkdtempSync(join(tmpdir(), 'bot-offline-'));
  dirs.push(dir);
  const t0 = Date.now();
  for (let r = 1; r <= 2; r++) await runOfflineRoom(sc, r, dir, seatNames(sc, r), { tickRate: 60, networkRate: 20, seed });
  const reports = readdirSync(dir).sort();
  return { dir, wallS: (Date.now() - t0) / 1000, reports, matches: reports.map((d) => JSON.parse(readFileSync(join(dir, d, 'match.json'), 'utf8'))) };
}

describe('offline arena', () => {
  beforeAll(async () => {
    if (!seededIds().length) await registerSourceGames();
  });
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('rejects human seats', () => {
    expect(validateScenario({ name: 'x', seats: [{ bot: 'hard' }, { human: true }] }, true)[0]).toMatch(/bots only/);
  });

  it('writes one live-format report per seat, timed in simulated seconds', async () => {
    const { dir, wallS, reports, matches } = await run(3);
    expect(reports).toEqual(['OFF1-Easy.R1', 'OFF1-Semigod.R1', 'OFF2-Easy.R2', 'OFF2-Semigod.R2']);
    for (const m of matches) {
      expect(m.serverConfig).toEqual({ tickRate: 60, networkRate: 20 });
      expect(m.rounds.length).toBeGreaterThanOrEqual(1);
      expect(m.rounds[0].variant).toBe('smashball');
      expect(m.rounds[0].myPlace).toBeGreaterThan(0);
      expect(m.rounds[0].durationS).toBeGreaterThan(wallS);
      // each round starts with the room's countdown, which the bots see as phase 'countdown'
      expect(m.rounds[0].durationS).toBeGreaterThan(COUNTDOWN_SECONDS);
      expect(m.ranking).toHaveLength(2);
      expect(m.latency.snapshotGapMs.p50).toBe(50);
    }
    // the bot sees what the network carries: positions, no ball velocities
    const incidents = reports.flatMap((r) => readdirSync(join(dir, r, 'incidents')).map((f) => join(dir, r, 'incidents', f)));
    expect(incidents.length).toBeGreaterThan(0);
    const states = JSON.parse(readFileSync(incidents[0], 'utf8')).states as { state: { balls: Record<string, unknown>[] } }[];
    expect(states.length).toBeGreaterThan(0);
    for (const s of states) for (const b of s.state.balls) expect(b).not.toHaveProperty('vx');
  });

  it('plays several rooms one after another into separate reports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-offline-'));
    dirs.push(dir);
    const rooms = await Promise.all([1, 2, 3].map((r) => runOfflineRoom(sc, r, dir, seatNames(sc, r), { tickRate: 60, networkRate: 20, seed: 9 })));
    expect(rooms.map((r) => r.code)).toEqual(['OFF1', 'OFF2', 'OFF3']);
    expect(readdirSync(dir)).toHaveLength(6);
  });

  it('is deterministic for a seed', async () => {
    const places = async (seed: number) => (await run(seed)).matches.map((m) => m.rounds.map((r: { myPlace: number }) => r.myPlace));
    expect(await places(5)).toEqual(await places(5));
  });
});
