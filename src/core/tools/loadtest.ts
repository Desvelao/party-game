/**
 * Headless load tester: spins up N bots per room across M rooms, plays real
 * matches for --duration seconds and reports what the server measured.
 *
 *   npm run loadtest -- --url ws://localhost:8080/ws --players 8 --rooms 1 --duration 30
 *   npm run loadtest -- --game ballistix --variant cloud-orbs   # one variant only
 *   npm run loadtest -- --game ballistix --variant smashball --opt lives=3 --opt balls=4
 *   npm run loadtest -- --players 8 --spectators 8             # watchers per room
 *   npm run loadtest -- --sweep                       # 1,2,4,8,12,16 players
 *   npm run loadtest -- --players 8 --rooms 1,2,3,4   # find the room limit
 */
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type PlayerInfo, type RoomPhase, type ServerMessage } from '../shared';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const USAGE = `usage: npm run loadtest -- [options]      (built: node dist/loadtest.js [options])

--url URL           server websocket (default ws://localhost:8080/ws)
--players N[,N...]  bots per room (default 8)
--rooms N[,N...]    concurrent rooms (default 1)
--duration SECONDS  how long to play (default 20)
--spectators N      watchers per room
--sweep             shortcut for --players 1,2,4,8,12,16
--game ID           game family (only honoured on room creation)
--variant ID        variant within --game
--opt key=value     game option, repeatable
--stats URL         stats endpoint (default derived from --url)
-h, --help          show this text`;
if (flag('help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const list = (s: string) => s.split(',').map((x) => Number.parseInt(x, 10)).filter((n) => n > 0);

const game = arg('game', '');
const variant = arg('variant', '');
// repeated: --opt lives=8 --opt smashEnabled=false --opt balls=3
const gameOptions: Record<string, number | boolean | string> = {};
process.argv.forEach((a, i) => {
  if (a !== '--opt' || !process.argv[i + 1]) return;
  const [k, ...rest] = process.argv[i + 1].split('=');
  const v = rest.join('=');
  gameOptions[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && !Number.isNaN(Number(v)) && k !== 'balls' ? Number(v) : v;
});
const spectatorsPerRoom = Number.parseInt(arg('spectators', '0'), 10) || 0;
const url = arg('url', 'ws://localhost:8080/ws');
const duration = Number.parseInt(arg('duration', '20'), 10);
const playerCounts = flag('sweep') ? [1, 2, 4, 8, 12, 16] : list(arg('players', '8'));
const roomCounts = list(arg('rooms', '1'));
const statsUrl = arg('stats', url.replace(/^ws/, 'http').replace(/\/ws$/, '/stats'));

interface Totals {
  states: number;
  bytesIn: number;
  msgsIn: number;
  errors: string[];
  disconnects: number;
  rtts: number[];
  matchesStarted: number;
}

class Bot {
  ws!: WebSocket;
  id = '';
  phase: RoomPhase = 'lobby';
  players: PlayerInfo[] = [];
  hostId = '';
  private inputTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private dir = Math.random() * Math.PI * 2;
  private started = false;
  closedByUs = false;

  constructor(
    private readonly name: string,
    private readonly totals: Totals,
    private readonly onCode?: (code: string) => void,
    private readonly spectator = false,
  ) {}

  connect(code?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.on('open', () => {
        // game/variant are only honoured on room creation (no code)
        this.send({
          t: 'JOIN_ROOM',
          v: PROTOCOL_VERSION,
          name: this.name,
          code,
          ...(this.spectator ? { spectate: true } : {}),
          ...(!code && game ? { game, variant, ...(Object.keys(gameOptions).length ? { options: gameOptions } : {}) } : {}),
        } as ClientMessage);
      });
      ws.on('message', (data) => {
        const raw = data.toString();
        this.totals.msgsIn++;
        this.totals.bytesIn += raw.length;
        const msg = JSON.parse(raw) as ServerMessage;
        this.handle(msg, resolve);
      });
      ws.on('error', (e) => reject(e));
      ws.on('close', () => {
        clearInterval(this.inputTimer);
        clearInterval(this.pingTimer);
        if (!this.closedByUs) this.totals.disconnects++;
      });
    });
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private handle(msg: ServerMessage, resolveJoin: () => void): void {
    switch (msg.t) {
      case 'WELCOME':
        this.id = msg.id;
        this.onCode?.(msg.code);
        this.pingTimer = setInterval(() => this.send({ t: 'PING', ts: performance.now() }), 1000);
        if (!this.spectator) this.inputTimer = setInterval(() => this.sendInput(), 33);
        resolveJoin();
        break;
      case 'PONG':
        this.totals.rtts.push(performance.now() - msg.ts);
        break;
      case 'GAME_STATE':
        this.totals.states++;
        break;
      case 'ERROR':
        this.totals.errors.push(`${msg.code}: ${msg.message}`);
        resolveJoin();
        break;
      case 'ROOM_UPDATE':
        if (this.spectator) break;
        this.phase = msg.phase;
        this.players = msg.players;
        this.hostId = msg.hostId;
        this.lobbyLogic();
        if (msg.phase === 'results' && this.id === this.hostId) this.send({ t: 'NEXT_GAME' });
        break;
      case 'MATCH_FINISHED':
        if (this.id === this.hostId) setTimeout(() => this.send({ t: 'REMATCH' }), 300);
        break;
    }
  }

  private lobbyLogic(): void {
    if (this.phase !== 'lobby') {
      this.started = false;
      return;
    }
    const me = this.players.find((p) => p.id === this.id);
    if (this.id !== this.hostId) {
      if (me && !me.ready) this.send({ t: 'READY', ready: true });
      return;
    }
    const others = this.players.filter((p) => p.id !== this.id);
    if (!this.started && others.every((p) => p.ready) && this.expected === this.players.length) {
      this.started = true;
      this.totals.matchesStarted++;
      this.send({ t: 'START_GAME' });
    }
  }

  expected = 0;

  private sendInput(): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    if (Math.random() < 0.08) this.dir += (Math.random() - 0.5) * 2.5;
    this.send({
      t: 'INPUT',
      seq: 0,
      mx: Math.round(Math.cos(this.dir) * 100) / 100,
      my: Math.round(Math.sin(this.dir) * 100) / 100,
      a1: Math.random() < 0.03,
      a2: false,
    });
  }

  close(): void {
    this.closedByUs = true;
    this.ws.close();
  }
}

async function fetchStats(reset: boolean): Promise<any> {
  const token = process.env.ADMIN_TOKEN;
  const res = await fetch(statsUrl + (reset ? '?reset=1' : ''), {
    headers: reset && token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`/stats ${res.status}${reset ? ' (set ADMIN_TOKEN to match the server)' : ''}`);
  return res.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function runCase(players: number, rooms: number) {
  const totals: Totals = { states: 0, bytesIn: 0, msgsIn: 0, errors: [], disconnects: 0, rtts: [], matchesStarted: 0 };
  const bots: Bot[] = [];

  for (let r = 0; r < rooms; r++) {
    let code = '';
    const host = new Bot(`bot${r}-0`, totals, (c) => (code = c));
    host.expected = players;
    bots.push(host);
    await host.connect();
    if (!code) break; // join failed (see errors)
    for (let i = 1; i < players; i++) {
      const b = new Bot(`bot${r}-${i}`, totals);
      b.expected = players;
      bots.push(b);
      await b.connect(code);
    }
    for (let i = 0; i < spectatorsPerRoom; i++) {
      const w = new Bot(`watch${r}-${i}`, totals, undefined, true);
      bots.push(w);
      await w.connect(code);
    }
  }

  await sleep(1500);
  await fetchStats(true); // start of measurement window
  const t0 = performance.now();
  totals.states = totals.msgsIn = totals.bytesIn = 0;
  totals.rtts = [];
  await sleep(duration * 1000);
  const secs = (performance.now() - t0) / 1000;
  const s = await fetchStats(false);
  bots.forEach((b) => b.close());
  await sleep(300);

  return {
    players,
    rooms,
    clients: bots.length,
    cpuPct: s.cpuPercent as number,
    rssMB: s.rssMB as number,
    tickAvgMs: s.loop.avgStepMs as number,
    tickMaxMs: s.loop.maxStepMs as number,
    lagAvgMs: s.loop.avgLagMs as number,
    lagMaxMs: s.loop.maxLagMs as number,
    overruns: s.loop.overruns as number,
    serverMsgsOutPerSec: s.net.msgsOut / secs,
    serverKBpsOut: s.net.bytesOut / 1024 / secs,
    droppedFrames: s.net.droppedFrames as number,
    rttAvgMs: totals.rtts.length ? totals.rtts.reduce((a, b) => a + b, 0) / totals.rtts.length : 0,
    rttP95Ms: pct(totals.rtts, 95),
    rttMaxMs: Math.max(0, ...totals.rtts),
    disconnects: totals.disconnects,
    errors: [...new Set(totals.errors)],
  };
}

async function main() {
  console.log(`# loadtest url=${url} duration=${duration}s`);
  const rows = [];
  for (const rooms of roomCounts) {
    for (const players of playerCounts) {
      process.stdout.write(`running ${rooms} room(s) x ${players} players ... `);
      try {
        const r = await runCase(players, rooms);
        rows.push(r);
        console.log(r.errors.length ? `errors: ${r.errors.join('; ')}` : 'done');
      } catch (e) {
        console.log(`failed: ${(e as Error).message}`);
      }
      await sleep(500);
    }
  }
  const f = (n: number, d = 1) => n.toFixed(d);
  console.log('\n| rooms | players | CPU % | RSS MB | tick avg/max ms | lag avg/max ms | overruns | msgs/s out | KB/s out | RTT avg/p95/max ms | drops | disconnects |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.rooms} | ${r.players} | ${f(r.cpuPct)} | ${f(r.rssMB)} | ${f(r.tickAvgMs, 2)}/${f(r.tickMaxMs, 2)} | ${f(r.lagAvgMs, 2)}/${f(r.lagMaxMs, 1)} | ${r.overruns} | ${f(r.serverMsgsOutPerSec, 0)} | ${f(r.serverKBpsOut)} | ${f(r.rttAvgMs)}/${f(r.rttP95Ms)}/${f(r.rttMaxMs)} | ${r.droppedFrames} | ${r.disconnects} |`,
    );
  }
  if (flag('json')) console.log(JSON.stringify(rows));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
