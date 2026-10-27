// Classifies why a life was lost, from the bot's own recent decisions. The rules are deliberately simple and the
// evidence is dumped in `detail` so a later analysis can refine them.
import type { Incident } from '../../../core/shared/ai';

export interface RingEntry {
  time: number;
  pos: number;
  vel: number;
  len: number;
  target: number;
  mx: number;
  chosen: number | null;
  ready: number;
  smash: boolean;
  threats: { id: number; t: number; x: number; slack: number; bounces: number }[];
  balls: { id: number; x: number; y: number; vx: number; vy: number }[];
}

const r = (n: number) => Math.round(n * 10) / 10;

/** `ev` is where the ball crossed our goal line, in the bot's frame. */
export function classifyGoal(ring: RingEntry[], ev: { x: number; y: number }, ballR: number, time: number, params: Record<string, number>): Incident {
  const recent = ring.slice(-6);
  let ballId = -1;
  let deepest = -Infinity;
  for (const e of recent) for (const b of e.balls) if (b.y > deepest) ((deepest = b.y), (ballId = b.id));

  const series = ring.map((e) => ({ e, th: e.threats.find((t) => t.id === ballId) })).filter((s) => ballId >= 0 && s.e.balls.some((b) => b.id === ballId));
  const withThreat = series.filter((s) => s.th);
  const last = ring[ring.length - 1];
  const half = (last?.len ?? 130) / 2 + ballR * 0.6;
  const base = { ballId, crossingX: r(ev.x), params, window: ring.slice(-30) };

  const make = (cause: string, summary: string, extra: Record<string, unknown> = {}): Incident => ({ cause, t: r(time), summary, detail: { ...base, ...extra } });

  if (!last || ballId < 0) return make('untracked', 'goal conceded but no ball was visible in the bot state');
  if (!withThreat.length) return make('never-predicted', `ball ${ballId} was never predicted to reach the goal (velocity unknown, bounce off a paddle/ball, or obstacle)`);

  const firstT = withThreat[0].th!;
  const lastT = withThreat[withThreat.length - 1].th!;
  const lastErr = Math.abs(lastT.x - ev.x);
  if (lastErr > half) return make('mispredicted', `predicted x ${r(lastT.x)} but it crossed at ${r(ev.x)} (${lastT.bounces} bounces)`, { predictionError: r(lastErr), lastPrediction: lastT });
  if (firstT.slack < -0.03) {
    const other = withThreat[0].e.chosen !== ballId;
    return make(other ? 'double-threat' : 'unreachable', `first seen ${r(firstT.t * 1000)} ms before impact with ${r(firstT.slack * 1000)} ms slack${other ? ' while busy with another ball' : ''}`, { first: firstT });
  }
  const endTime = withThreat[withThreat.length - 1].e.time;
  if (withThreat.some((s) => s.e.time >= endTime - 0.3 && s.e.chosen !== ballId)) return make('wrong-ball', 'the bot was heading for a different ball in the last 300 ms', { first: firstT, last: lastT });
  const padErr = Math.abs(last.pos - ev.x);
  if (padErr > half) return make('paddle-lag', `ball was reachable (slack ${r(firstT.slack * 1000)} ms) but the paddle was ${r(padErr)} px off`, { first: firstT, last: lastT, paddleError: r(padErr), paddleVel: r(last.vel) });
  return make('clipped', `paddle was in range (${r(padErr)} px off) yet the ball got through: edge hit, speed or a ball-ball collision`, { first: firstT, last: lastT, paddleError: r(padErr) });
}
