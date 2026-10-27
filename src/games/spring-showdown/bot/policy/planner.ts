// The Spring Showdown policy. It searches every path of `depth` hops from the tile it is heading to (a hop cannot be
// changed once it started), on a copy of the board it paints as it goes, and scores each hop: squares gained (a
// rival's more than an empty one, the leader's more still), banking (a crate, or a closing loop where that banks),
// items, and the hazards of being on that tile at that time (missiles flying along its row or column, TNT,
// mushrooms, a lined-up rival holding a missile). Past the horizon, distance to the nearest paintable square and to a
// crate add a little, so it does not stall in its own colour. Items are fired separately, when a rival is lined up.
import { enclosedTiles } from '../../server/loops';
import { BOOTS_FACTOR, DIR_BIT, DX, DY, MISSILE_SPEED, inBeam } from '../../server/SpringShowdown';
import type { Rules, VariantAdapter } from '../variants';
import type { WPlayer, World } from '../world';
import { idle, type Decision, type Policy } from './types';

const GAMMA = 0.88;
const PLAN_MS = 200;

export class PlannerPolicy implements Policy {
  private sim: number[] = [];
  private noiseArr: number[] = [];
  private distPaint: Int16Array = new Int16Array(0);
  private distCrate: Int16Array = new Int16Array(0);
  private queue: Int32Array = new Int32Array(0);
  private lastFireTry = 0;
  private planKey = '';
  private planAt = -Infinity;
  private plan: Decision = idle();

  constructor(private readonly P: Record<string, number>, private readonly rng: () => number, private adapter: VariantAdapter) {}

  setAdapter(a: VariantAdapter): void {
    this.adapter = a;
  }

  decide(w: World, nowMs: number): Decision {
    const me = w.me;
    if (!me) return idle();
    if (me.stun) return idle('stunned');
    // plan once per hop (and every PLAN_MS while standing or as the board changes); firing is checked every time
    const key = `${me.c},${me.r},${me.item},${me.boots > 0}`;
    if (key !== this.planKey || nowMs - this.planAt >= PLAN_MS) {
      this.planKey = key;
      this.planAt = nowMs;
      this.plan = this.planMove(w, me);
    }
    const dec: Decision = { ...this.plan, info: { ...this.plan.info } };
    this.considerFire(w, me, this.adapter.rules, dec, nowMs, w.hopTime * (me.boots > 0 ? BOOTS_FACTOR : 1));
    return dec;
  }

  private planMove(w: World, me: WPlayer): Decision {
    const P = this.P;
    const n = w.n;
    const R = this.adapter.rules;
    if (this.sim.length !== n * n) {
      this.sim = new Array(n * n).fill(-1);
      this.noiseArr = new Array(n * n).fill(0);
      this.distPaint = new Int16Array(n * n);
      this.distCrate = new Int16Array(n * n);
      this.queue = new Int32Array(n * n);
    }
    for (let i = 0; i < n * n; i++) {
      this.sim[i] = w.tiles[i];
      this.noiseArr[i] = P.noise ? (this.rng() * 2 - 1) * P.noise : 0;
    }
    const myCount = me.tiles;
    this.horizonMaps(w, me);

    const hop = w.hopTime * (me.boots > 0 ? BOOTS_FACTOR : 1);
    // the hop under way lands on (c, r); new hops start from there
    const t0 = me.hop < 1 ? (1 - me.hop) * hop : 0;
    const depth = Math.max(1, Math.min(4, Math.round(P.depth)));
    let best = -Infinity;
    let bestDir = -1;
    for (let d = 0; d < 4; d++) {
      const v = this.search(w, me, R, me.c, me.r, d, 0, depth, t0, hop, myCount);
      if (v > best) {
        best = v;
        bestDir = d;
      }
    }
    const dec = idle('plan');
    dec.dir = best > 0 ? bestDir : -1;
    dec.value = best;
    dec.info.value = +best.toFixed(2);
    return dec;
  }

  /** value of hopping `d` from (c, r) at step k, plus the best continuation */
  private search(w: World, me: WPlayer, R: Rules, c: number, r: number, d: number, k: number, depth: number, t: number, hop: number, mine: number): number {
    const n = w.n;
    const nc = c + DX[d];
    const nr = r + DY[d];
    if (nc < 0 || nr < 0 || nc >= n || nr >= n) return -Infinity;
    // players are solid: the server refuses a hop onto an occupied square (later hops: rivals will have moved)
    if (k === 0 && w.state.solid && this.occupied(w, me, nc, nr)) return -Infinity;
    const i = nr * n + nc;
    const P = this.P;
    const sim = this.sim;
    let v = 0;
    let gained = 0;
    let wipe = false;
    const owner = sim[i];
    // painting (or wiping)
    if (owner === me.idx) {
      if (R.selfWipe && me.lock <= 0) {
        v -= (mine * 1.5 + 3) * P.careful;
        wipe = true;
      } else v -= 0.05;
    } else if (owner >= 0 && this.locked(w, owner)) {
      v += 0;
    } else {
      gained = 1;
      v += owner === -1 ? 1 : w.allies.has(owner) ? -0.3 : 1.3 + (this.isLeader(w, owner) ? 0.3 : 0);
    }
    v += this.noiseArr[i];
    const prevOwner = owner;
    if (gained) sim[i] = me.idx;
    let nowMine = wipe ? 0 : mine + gained;
    // the item on the tile
    for (const it of w.items) {
      if (it.c !== nc || it.r !== nr) continue;
      v += this.itemValue(w, me, R, it.k, it.d, nc, nr, nowMine);
      if (it.k === 'crate' && R.scoreBy === 'crates') nowMine = 0;
    }
    // loops close on every landing where that rule is on (only the first two hops: it is the costly part)
    if (R.fillEnclosed && P.enclose && k < 2 && gained && this.mayClose(sim, n, nc, nr, me.idx)) {
      const inside = enclosedTiles(sim, n, me.idx);
      let g = 0;
      for (const j of inside) if (sim[j] !== me.idx && !(sim[j] >= 0 && this.locked(w, sim[j]))) g++;
      if (g > 0) {
        v += g;
        if (R.scoreBy === 'enclose') {
          // closing banks everything and clears it: a small bank throws away the colour a bigger loop would use
          v += P.bank * (nowMine + g) - (nowMine + g < P.encloseMin ? nowMine * 1.2 : 0);
          nowMine = 0;
        }
      }
    }
    // hazards while we are on this tile: from half-way through the hop in to half-way through the hop out
    v -= this.danger(w, R, nc, nr, t + hop * 0.5, t + hop * 1.5) * P.hazards;

    let total = v * GAMMA ** k;
    if (k + 1 < depth) {
      let bestNext = -Infinity;
      for (let d2 = 0; d2 < 4; d2++) {
        // going straight back is rarely useful and doubles the work
        if (d2 === (d + 2) % 4 && k > 0) continue;
        const nv = this.search(w, me, R, nc, nr, d2, k + 1, depth, t + hop, hop, nowMine);
        if (nv > bestNext) bestNext = nv;
      }
      if (bestNext > -Infinity) total += bestNext;
    } else total += this.horizon(i, nowMine) * GAMMA ** (k + 1);
    sim[i] = prevOwner;
    return total;
  }

  private occupied(w: World, me: WPlayer, c: number, r: number): boolean {
    for (const q of w.state.players) {
      if (q.gone || q.id === me.id) continue;
      if ((q.c === c && q.r === r) || (q.hop < 1 && q.pc === c && q.pr === r)) return true;
    }
    return false;
  }

  private itemValue(w: World, me: WPlayer, R: Rules, k: string, mask: number, c: number, r: number, mine: number): number {
    const P = this.P;
    const bonus = this.adapter.itemBonus?.[k] ?? 0;
    switch (k) {
      case 'crate':
        return R.scoreBy === 'crates' ? P.bank * mine : 0;
      case 'boots':
        return (2 + bonus) * P.items;
      case 'missile':
      case 'beam':
        return ((me.item ? 0.5 : 3) + bonus) * P.items;
      case 'padlock':
        return (2 + mine * 0.15 + bonus) * P.items;
      case 'arrow': {
        let cnt = 0;
        for (let d = 0; d < 4; d++) {
          if (!(mask & DIR_BIT[d])) continue;
          for (let s = 1; s < w.n; s++) {
            const x = c + DX[d] * s;
            const y = r + DY[d] * s;
            if (x < 0 || y < 0 || x >= w.n || y >= w.n) break;
            const o = this.sim[y * w.n + x];
            if (o !== me.idx && !(o >= 0 && this.locked(w, o))) cnt++;
          }
        }
        return (cnt * 0.7 + bonus) * P.items;
      }
      case 'mushroom':
        return -6 * P.hazards;
      case 'tnt':
        return -9 * P.hazards;
    }
    return 0;
  }

  /** a loop can only close here if this tile touches our colour on two sides or more (the arena edge never closes a loop) */
  private mayClose(sim: number[], n: number, c: number, r: number, me: number): boolean {
    let k = 0;
    for (let d = 0; d < 4; d++) {
      const x = c + DX[d];
      const y = r + DY[d];
      if (x >= 0 && y >= 0 && x < n && y < n && sim[y * n + x] === me) k++;
    }
    return k >= 2;
  }

  /** expected trouble of standing on (c, r) during [ta, tb] */
  private danger(w: World, R: Rules, c: number, r: number, ta: number, tb: number): number {
    let d = 0;
    for (const m of w.missiles) {
      const vertical = m.dir === 0 || m.dir === 2;
      if (vertical ? Math.floor(m.x) !== c : Math.floor(m.y) !== r) continue;
      const pos = vertical ? m.y : m.x;
      const vel = (vertical ? DY[m.dir] : DX[m.dir]) * MISSILE_SPEED;
      const cell = vertical ? r : c;
      // times the missile is inside [cell, cell + 1)
      let t1 = (cell - pos) / vel;
      let t2 = (cell + 1 - pos) / vel;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t2 >= ta && t1 <= tb && t2 >= 0) d += 8;
    }
    // a lit TNT blasts its surroundings when the fuse ends (time counted from the snapshot, like ta and tb)
    const blast = w.state.blast ?? 1;
    for (const it of w.items) {
      if (it.k !== 'tnt' || it.f === undefined) continue;
      if (Math.max(Math.abs(it.c - c), Math.abs(it.r - r)) <= blast && it.f >= ta && it.f <= tb) d += 8;
    }
    for (const q of w.rivals) {
      if (q.stun) continue;
      if (q.item === 'missile' && (q.c === c || q.r === r || R.fourWayMissile)) {
        if (q.c === c || q.r === r) d += 1.5;
      }
      if (q.item === 'beam' && inBeam(q.c, q.r, q.f, c, r)) d += 1;
    }
    return d;
  }

  /** multi-source distances to the squares worth painting and to the crates */
  private horizonMaps(w: World, me: WPlayer): void {
    const n = w.n;
    const fill = (dist: Int16Array, isSource: (i: number) => boolean) => {
      let head = 0;
      let tail = 0;
      for (let i = 0; i < n * n; i++) {
        if (isSource(i)) {
          dist[i] = 0;
          this.queue[tail++] = i;
        } else dist[i] = -1;
      }
      while (head < tail) {
        const i = this.queue[head++];
        const c = i % n;
        const r = (i - c) / n;
        for (let d = 0; d < 4; d++) {
          const x = c + DX[d];
          const y = r + DY[d];
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const j = y * n + x;
          if (dist[j] >= 0) continue;
          dist[j] = dist[i] + 1;
          this.queue[tail++] = j;
        }
      }
    };
    fill(this.distPaint, (i) => w.tiles[i] !== me.idx && !(w.tiles[i] >= 0 && (this.locked(w, w.tiles[i]) || w.allies.has(w.tiles[i]))));
    const crates = new Set<number>();
    for (const it of w.items) if (it.k === 'crate') crates.add(it.r * n + it.c);
    fill(this.distCrate, (i) => crates.has(i));
  }

  private horizon(i: number, mine: number): number {
    let h = 0;
    const dp = this.distPaint[i];
    if (dp >= 0) h += 0.8 / (1 + dp);
    const dc = this.distCrate[i];
    if (dc >= 0 && this.adapter.rules.scoreBy === 'crates') h += (this.P.bank * mine * 0.6) / (1 + dc);
    return h;
  }

  private locked(w: World, owner: number): boolean {
    return (w.state.players[owner]?.lock ?? 0) > 0;
  }

  private isLeader(w: World, owner: number): boolean {
    const o = w.state.players[owner];
    if (!o) return false;
    return w.rivals.every((q) => q.idx === owner || q.score + q.tiles <= o.score + o.tiles);
  }

  /** fire the held item when it will hit: a rival lined up (missile) or ahead in the facing line (beam) */
  private considerFire(w: World, me: WPlayer, R: Rules, dec: Decision, nowMs: number, hop: number): void {
    if (!me.item) return;
    const P = this.P;
    // where we are for the server: the start tile in the first half of a hop
    const [mc, mr] = me.hop < 0.5 ? [me.pc, me.pr] : [me.c, me.r];
    const blind = nowMs - this.lastFireTry > 1000 && this.rng() < 1 - P.aim;
    if (nowMs - this.lastFireTry > 1000) this.lastFireTry = nowMs;
    if (me.item === 'beam') {
      let hits = 0;
      for (const q of w.rivals) {
        if (q.inv || q.stun) continue;
        const [qc, qr] = q.hop < 0.5 ? [q.pc, q.pr] : [q.c, q.r];
        if (inBeam(mc, mr, me.f, qc, qr)) hits++;
      }
      // the beam stuns everyone in the line, teammates too
      let friends = 0;
      for (const idx of w.allies) {
        const a = w.state.players[idx];
        if (a && !a.gone && inBeam(mc, mr, me.f, a.hop < 0.5 ? a.pc : a.c, a.hop < 0.5 ? a.pr : a.r)) friends++;
      }
      if ((hits > friends) || (blind && friends === 0)) {
        dec.fire = true;
        dec.fireDir = me.f;
        dec.mode = 'beam';
      }
      return;
    }
    let bestDir = -1;
    let bestScore = 0;
    for (const q of w.rivals) {
      if (q.inv || q.stun) continue;
      for (let d = 0; d < 4; d++) {
        // the tile the rival will be on when the missile gets there
        const dist = Math.abs(q.c - mc) + Math.abs(q.r - mr);
        const arrive = dist / MISSILE_SPEED;
        const late = q.hop >= 0.5 || arrive > (0.5 - q.hop) * hop;
        const [qc, qr] = late ? [q.c, q.r] : [q.pc, q.pr];
        const lined = DX[d] !== 0 ? qr === mr && Math.sign(qc - mc) === DX[d] : qc === mc && Math.sign(qr - mr) === DY[d];
        if (!lined) continue;
        // the missile hits the first player in its way (a teammate included): another one nearer absorbs it
        const blocked = w.state.players.some((o, oi) => {
          if (o.gone || oi === me.idx || oi === q.idx) return false;
          const od = Math.abs(o.c - mc) + Math.abs(o.r - mr);
          if (od >= dist) return false;
          return DX[d] !== 0 ? o.r === mr && Math.sign(o.c - mc) === DX[d] : o.c === mc && Math.sign(o.r - mr) === DY[d];
        });
        if (blocked) continue;
        // in Spring Lock a hit steals all the victim's squares
        const score = 1 + (R.steal && q.lock <= 0 ? q.tiles * 0.2 : 0) + (this.isLeader(w, q.idx) ? 1 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestDir = d;
        }
      }
    }
    if (R.fourWayMissile && bestDir >= 0) bestDir = me.f;
    if (bestDir < 0 && blind) bestDir = me.f;
    if (bestDir < 0) return;
    dec.fire = true;
    dec.fireDir = bestDir;
    dec.mode = 'missile';
  }
}
