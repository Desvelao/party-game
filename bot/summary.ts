import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The markdown summary of the bot reports (bot/analyze.ts reads the folders, this only formats). */

export interface Placement { id: string; name: string; place: number; points: number }
export interface Round { index: number; gameId?: string; variant: string; durationS: number; myPlace: number | null; myPoints: number | null; placements: Placement[]; incidents: number; incidentCauses: Record<string, number>; metrics: Record<string, number> }
export interface Match { selection?: { game?: string }; startedAt: string; room: string; name: string; level?: string; scenario?: string; policy: string; params: Record<string, number>; serverConfig: { tickRate: number; networkRate: number }; rounds: Round[]; latency: { rttMs: { p95: number } | null; snapshotGapMs: { mean: number; p95: number } | null } }

export interface Run { name: string; m: Match; group: string }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-');

/** `runs` as scanned from `dir` (reports are `<dir>/<name>/incidents/`) */
export function buildSummary(runs: Run[], dir: string, generated = new Date()): string {

  /** the game of a round: the match's selection (a playlist or the mixed rotation names the playable instead); reports
   * from before the per-game AIs are Ballistix */
  const gameOf = (m: Match, r: Round) => {
    const sel = m.selection?.game;
    return sel && sel !== 'custom' && sel !== 'mixed' ? sel : r.gameId || 'ballistix';
  };
  const games = [...new Set(runs.flatMap(({ m }) => m.rounds.map((r) => gameOf(m, r))))].sort();

  // group by game + policy + params + variant: the main table has the metrics every game reports, Ballistix adds its own
  interface Group { game: string; policy: string; level: string; params: string; variant: string; rounds: Round[] }
  const groups = new Map<string, Group>();
  for (const { m } of runs) {
    for (const r of m.rounds) {
      const game = gameOf(m, r);
      const key = `${game}|${m.policy}|${m.level ?? ''}|${JSON.stringify(m.params)}|${r.variant}`;
      const g = groups.get(key) ?? { game, policy: m.policy, level: m.level ?? '', params: JSON.stringify(m.params), variant: r.variant, rounds: [] };
      g.rounds.push(r);
      groups.set(key, g);
    }
  }
  const stats = (g: Group) => {
    const placed = g.rounds.filter((r) => r.myPlace != null);
    const wins = placed.filter((r) => r.myPlace === 1).length;
    return { n: g.rounds.length, wins: pct(wins, placed.length), place: fmt(sum(placed.map((r) => r.myPlace!)) / (placed.length || 1)), points: fmt(sum(placed.map((r) => r.myPoints ?? 0)) / (placed.length || 1)) };
  };

  const md: string[] = [];
  md.push(`# Bot report summary`, '', `${runs.length} match report(s) in \`${dir}\`, ${sum(runs.map((r) => r.m.rounds.length))} round(s). Generated ${generated.toISOString()}.`, '');
  if (groups.size) md.push('## Results by game / policy / parameters / variant', '', '| game | policy | level | variant | rounds | wins | avg place | avg points |', '|---|---|---|---|---|---|---|---|');
  for (const g of groups.values()) {
    const s = stats(g);
    md.push(`| ${g.game} | ${g.policy} | ${g.level || '-'} | ${g.variant || '?'} | ${s.n} | ${s.wins} | ${s.place} | ${s.points} |`);
  }
  if (groups.size) md.push('', '### Parameter sets', '');
  for (const g of groups.values()) md.push(`- ${g.game} / ${g.policy}${g.level ? ` ${g.level}` : ''} / ${g.variant || '?'}: \`${g.params}\``);

  const ballistix = [...groups.values()].filter((g) => g.game === 'ballistix');
  if (ballistix.length) md.push('', '## Ballistix: extra columns by policy / parameters / variant', '', '| policy | level | variant | rounds | lives lost / round | hits / round | smashes / round | smash share of scoring | opp. hits / round | track corrected |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const g of ballistix) {
    const n = g.rounds.length;
    const mt = (k: string) => sum(g.rounds.map((r) => r.metrics[k] ?? 0));
    const corr = mt('trackCorrected');
    md.push(`| ${g.policy} | ${g.level || '-'} | ${g.variant || '?'} | ${n} | ${fmt(mt('goalsConceded') / n)} | ${fmt(mt('hits') / n)} | ${fmt(mt('smashes') / n)} | ${pct(mt('opponentGoalsAfterSmash'), mt('othersConceded'))} | ${fmt(mt('opponentHits') / n)} | ${pct(corr, corr + mt('trackFallback'))} |`);
  }

  // ---- level vs level: from the placements of every round, one count per room (each bot of a room wrote the same) ----
  const ORDER = ['easy', 'normal', 'hard', 'expert', 'semigod'];
  const levelOf = new Map<string, string>(); // `${group}|${name}` -> level
  for (const { m, group } of runs) if (m.level) levelOf.set(`${group}|${m.name}`, m.level);
  const seenRoom = new Set<string>();
  const pair = new Map<string, { w: number; n: number }>(); // `${a}>${b}` a's wins over b

  // every game: the averages of each metric its AI reports, per game / variant / level
  const perGame = new Map<string, { game: string; variant: string; level: string; rounds: Round[] }>();
  for (const { m } of runs) {
    for (const r of m.rounds) {
      const key = `${gameOf(m, r)}|${r.variant}|${m.level ?? ''}|${m.policy}`;
      const g = perGame.get(key) ?? { game: gameOf(m, r), variant: r.variant, level: m.level ? m.level : m.policy, rounds: [] };
      g.rounds.push(r);
      perGame.set(key, g);
    }
  }
  for (const game of games) {
    const rows = [...perGame.values()].filter((g) => g.game === game);
    const keys = [...new Set(rows.flatMap((g) => g.rounds.flatMap((r) => Object.keys(r.metrics ?? {}))))].sort();
    md.push('', `## ${game}: metrics per round`, '', `Means per round of what the AI counts (\`src/games/${game}/bot/index.ts\`; meanings in \`src/games/${game}/AGENTS.md\`).`, '');
    md.push(`| variant | level | rounds | wins | avg place | ${keys.join(' | ')} |`, `|---|---|---|---|---|${keys.map(() => '---').join('|')}|`);
    for (const g of rows) {
      const n = g.rounds.length;
      const placed = g.rounds.filter((r) => r.myPlace != null);
      const wins = placed.filter((r) => r.myPlace === 1).length;
      const avg = (k: string) => fmt(sum(g.rounds.map((r) => r.metrics?.[k] ?? 0)) / n);
      md.push(`| ${g.variant || game} | ${g.level} | ${n} | ${pct(wins, placed.length)} | ${fmt(sum(placed.map((r) => r.myPlace!)) / (placed.length || 1))} | ${keys.map(avg).join(' | ')} |`);
    }
  }

  const perLevel = new Map<string, { rounds: number; place: number; wins: number }>();
  let humanRounds = 0;
  for (const { m, group } of runs) {
    const key = group ? `${group}|${m.room}` : `${m.room}|${m.startedAt.slice(0, 16)}`;
    if (seenRoom.has(key)) continue;
    seenRoom.add(key);
    for (const r of m.rounds) {
      const ps = r.placements ?? [];
      if (ps.length < 2) continue;
      const who = ps.map((p) => ({ lv: levelOf.get(`${group}|${p.name}`) ?? 'human', place: p.place }));
      if (who.some((x) => x.lv === 'human')) humanRounds++;
      for (const x of who) {
        const a = perLevel.get(x.lv) ?? { rounds: 0, place: 0, wins: 0 };
        a.rounds++;
        a.place += x.place;
        if (x.place === 1) a.wins++;
        perLevel.set(x.lv, a);
      }
      for (const a of who) for (const b of who) {
        if (a === b || a.lv === b.lv) continue;
        const e = pair.get(`${a.lv}>${b.lv}`) ?? { w: 0, n: 0 };
        e.n++;
        e.w += a.place < b.place ? 1 : a.place === b.place ? 0.5 : 0;
        pair.set(`${a.lv}>${b.lv}`, e);
      }
    }
  }
  const lvls = [...perLevel.keys()].sort((a, b) => (ORDER.indexOf(a) < 0 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 99 : ORDER.indexOf(b)));
  if (lvls.length > 1) {
    md.push('', '## Level vs level', '', `Share of rounds the row beat the column (rounds with two or more levels; ${humanRounds} round(s) included a human, shown as "human").`, '');
    md.push(`| | ${lvls.join(' | ')} | rounds | avg place | round wins |`, `|---|${lvls.map(() => '---').join('|')}|---|---|---|`);
    for (const a of lvls) {
      const t = perLevel.get(a)!;
      md.push(`| **${a}** | ${lvls.map((b) => (a === b ? '.' : pair.has(`${a}>${b}`) ? `${pct(pair.get(`${a}>${b}`)!.w, pair.get(`${a}>${b}`)!.n)} (${pair.get(`${a}>${b}`)!.n})` : '-')).join(' | ')} | ${t.rounds} | ${fmt(t.place / t.rounds)} | ${pct(t.wins, t.rounds)} |`);
    }
    const ladder: string[] = [];
    const bots = lvls.filter((l) => ORDER.includes(l));
    for (let i = 1; i < bots.length; i++) {
      const e = pair.get(`${bots[i]}>${bots[i - 1]}`);
      if (e && e.n >= 5 && e.w / e.n < 0.65) ladder.push(`- ${bots[i]} beat ${bots[i - 1]} in only ${pct(e.w, e.n)} of ${e.n} rounds (target 65%): the two presets in ${games.length === 1 ? `src/games/${games[0]}/bot/levels.ts` : 'the game\'s bot/levels.ts'} are too close (compare one game at a time).`);
      if (e && e.n < 5) ladder.push(`- ${bots[i]} vs ${bots[i - 1]}: only ${e.n} rounds, run more before judging.`);
    }
    md.push('', '### Ladder check', '', ladder.length ? ladder.join('\n') : 'Every level beats the one below it by at least 65%.');
  }

  const causes = new Map<string, number>();
  for (const { m } of runs) for (const r of m.rounds) for (const [c, n] of Object.entries(r.incidentCauses)) causes.set(c, (causes.get(c) ?? 0) + n);
  const totalInc = sum([...causes.values()]);
  md.push('', '## What went wrong (incident causes)', '', totalInc ? '| cause | count | share |\n|---|---|---|' : 'No incidents recorded.');
  for (const [c, n] of [...causes].sort((a, b) => b[1] - a[1])) md.push(`| ${c} | ${n} | ${pct(n, totalInc)} |`);
  if (games.length > 1 || games[0] !== 'ballistix') md.push('', `Each game names its own causes: see the "Incident causes" table in \`src/games/<game>/AGENTS.md\` (${games.join(', ')}).`);
  if (games.includes('ballistix')) md.push(
    '',
    'Ballistix cause meanings: `never-predicted` ball not projected to our goal (bounce off a paddle/ball or unknown velocity); `mispredicted` projection was off by more than the paddle half-length; `unreachable` / `double-threat` first seen too late to travel (or busy with another ball); `wrong-ball` switched target in the last 300 ms; `paddle-lag` reachable and predicted right but the paddle was not there; `clipped` paddle was in range yet it got through.',
  );

  md.push('', '## Per match', '', '| report | room | policy | tick/net Hz | rounds | places | rtt p95 ms | snapshot gap mean/p95 ms |', '|---|---|---|---|---|---|---|---|');
  for (const { name, m } of runs) {
    md.push(`| ${name} | ${m.room} | ${m.policy} | ${m.serverConfig?.tickRate}/${m.serverConfig?.networkRate} | ${m.rounds.length} | ${m.rounds.map((r) => r.myPlace ?? '?').join(',')} | ${fmt(m.latency.rttMs?.p95 ?? NaN)} | ${fmt(m.latency.snapshotGapMs?.mean ?? NaN, 0)}/${fmt(m.latency.snapshotGapMs?.p95 ?? NaN, 0)} |`);
  }

  md.push('', '## Incident files to read first', '', 'Each file under `<report>/incidents/` has the classified cause, evidence and the last ~1.5 s of bot decisions + snapshots.', '');
  let listed = 0;
  for (const { name } of [...runs].reverse()) {
    const idir = join(dir, name, 'incidents');
    if (!existsSync(idir)) continue;
    for (const f of readdirSync(idir).sort()) {
      if (listed++ < 25) md.push(`- ${join(name, 'incidents', f)}`);
    }
  }
  md.push('', '## Suggested next step', '', `Open the most common cause above, read 3-5 of its incident files, change the game's AI in \`src/games/${games.length === 1 ? games[0] : '<game>'}/bot/\` (its AGENTS.md maps each cause to the knobs), run more matches and compare the tables.`);

  return md.join('\n') + '\n';
}
