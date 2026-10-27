import type { Row } from './runner';

export interface Flag {
  variant: string;
  text: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function pct(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-');
const pc = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : '-');
const isDefault = (r: Row) => Object.keys(r.options).length === 0;
/** First place, unless everybody shares it (a draw). */
const isWin = (r: Row) => r.place === 1 && r.firstPlaces < r.playerCount;
const winners = (rs: Row[]) => rs.filter(isWin);
/** A round is one (seed, scenario, options, playerCount) group; its rows share the same duration. */
const roundsOf = (rs: Row[]) => rs.filter((r) => r.slot === 0);

function table(head: string[], body: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  return [line(head), w.map((n) => '-'.repeat(n)).join('  '), ...body.map(line)].join('\n');
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

/** Standard score of `wins` out of `n` against a fair chance `p`: |z| > 3 is hard to put down to luck. */
const zScore = (wins: number, n: number, p: number) => (n > 0 ? (wins - n * p) / Math.sqrt(n * p * (1 - p)) : 0);

/** Share of rounds a slot wins vs the fair 1/N (random bots only: any skew is the arena's). */
function slotBias(rows: Row[]): { text: string; worst: number; slot: string } {
  const rs = rows.filter((r) => r.scenario === 'random' && isDefault(r));
  const byCount = groupBy(rs, (r) => String(r.playerCount));
  let worst = 0;
  let slot = '';
  const parts: string[] = [];
  for (const [n, group] of [...byCount].sort((a, b) => +a[0] - +b[0])) {
    const rounds = roundsOf(group).length;
    const wins = winners(group);
    if (!rounds || !wins.length) continue;
    const count = +n;
    const won = Array.from({ length: count }, (_, i) => wins.filter((r) => r.slot === i).length);
    won.forEach((w, i) => {
      const z = zScore(w, rounds, 1 / count);
      if (Math.abs(z) > Math.abs(worst)) {
        worst = z;
        slot = `slot ${i + 1} of ${n} wins ${pc(w / rounds)} (fair ${pc(1 / count)})`;
      }
    });
    parts.push(`${n}p ${won.map((w) => pc(w / rounds)).join('/')}`);
  }
  return { text: parts.join('  '), worst, slot };
}

/** Win share of the special bot (greedy or idle among random) vs the fair 1/N, with how many rounds it rests on. */
function botEdge(rows: Row[], scenario: 'skill' | 'idle'): { edge: number; z: number; n: number } {
  const rs = rows.filter((r) => r.scenario === scenario && isDefault(r) && r.policy !== 'random');
  if (!rs.length) return { edge: NaN, z: 0, n: 0 };
  const fair = mean(rs.map((r) => 1 / r.playerCount));
  const wins = rs.filter(isWin).length;
  return { edge: wins / rs.length / fair, z: zScore(wins, rs.length, fair), n: rs.length };
}

export function report(rows: Row[]): { text: string; flags: Flag[] } {
  const flags: Flag[] = [];
  const variants = [...groupBy(rows, (r) => r.variant).keys()];
  const dur: string[][] = [];
  const bias: string[][] = [];
  const skill: string[][] = [];
  for (const v of variants) {
    const rs = rows.filter((r) => r.variant === v);
    const base = rs.filter(isDefault);
    const rounds = roundsOf(base);
    const durs = rounds.map((r) => r.durationSec);
    const limit = rounds[0]?.limitSec ?? NaN;
    const atLimit = rounds.filter((r) => r.durationSec >= r.limitSec - 0.5).length / (rounds.length || 1);
    const stuck = rounds.filter((r) => r.timedOut).length / (rounds.length || 1);
    dur.push([v, String(rounds.length), f(mean(durs)), f(pct(durs, 0.1)), f(pct(durs, 0.9)), f(limit, 0), pc(atLimit), pc(stuck)]);
    if (stuck > 0) flags.push({ variant: v, text: `${pc(stuck)} of rounds never finished (stuck)` });
    if (mean(durs) < 10) flags.push({ variant: v, text: `rounds are very short (${f(mean(durs))} s)` });

    const sb = slotBias(rs);
    bias.push([v, sb.text || '-']);
    if (Math.abs(sb.worst) > 3) flags.push({ variant: v, text: `spawn slot bias: ${sb.slot}` });

    const gain = botEdge(rs, 'skill');
    const idle = botEdge(rs, 'idle');
    skill.push([v, f(gain.edge, 2), f(idle.edge, 2), String(gain.n)]);
    if (gain.n >= 20 && gain.z < 2) flags.push({ variant: v, text: `skill gap ${f(gain.edge, 2)}x: the greedy bot is not clearly better than random` });
    if (idle.n >= 20 && idle.edge >= 0.8) flags.push({ variant: v, text: `an idle player wins ${f(idle.edge, 2)}x its fair share (camping is viable)` });
  }

  const sens: string[][] = [];
  for (const v of variants) {
    const rs = rows.filter((r) => r.variant === v);
    const baseDur = mean(roundsOf(rs.filter(isDefault)).map((r) => r.durationSec));
    const byPoint = groupBy(rs.filter((r) => !isDefault(r)), (r) => JSON.stringify(r.options));
    for (const [key, group] of byPoint) {
      const d = mean(roundsOf(group).map((r) => r.durationSec));
      const stuck = roundsOf(group).filter((r) => r.timedOut).length / (roundsOf(group).length || 1);
      sens.push([v, key.replace(/[{}"]/g, '').replace(/:/g, '='), f(d), `${d >= baseDur ? '+' : ''}${f(d - baseDur)}`, pc(stuck)]);
    }
  }

  const out = [
    'DURATION (default options, seconds)',
    table(['variant', 'rounds', 'mean', 'p10', 'p90', 'limit', 'at limit', 'stuck'], dur),
    '',
    'SPAWN SLOT WIN SHARE (random bots; fair = 100/N %)',
    table(['variant', 'slot win share by player count'], bias),
    '',
    'SKILL GAP (win share vs fair: greedy among random, idle among random; 1.00 = fair; flags need 20+ rounds)',
    table(['variant', 'greedy', 'idle', 'rounds'], skill),
  ];
  if (sens.length) out.push('', 'OPTION SENSITIVITY (one option moved at a time)', table(['variant', 'option', 'mean s', 'vs default', 'stuck'], sens));
  out.push('', flags.length ? 'FLAGS' : 'FLAGS: none', ...flags.map((x) => `  ${x.variant}: ${x.text}`));
  return { text: out.join('\n'), flags };
}
