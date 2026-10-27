import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { BotClient } from './client';

let wss: WebSocketServer | undefined;
afterEach(() => wss?.close());

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  let connections = 0;
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    connections++;
    ws.on('message', () => {
      ws.send(JSON.stringify({ t: 'WELCOME', id: 1, code: 'ABCD', config: { tickRate: 30, networkRate: 15 }, selection: {} }));
      setTimeout(() => ws.terminate(), 20);
    });
  });
  await new Promise((r) => wss!.once('listening', r));
  const client = new BotClient({
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    name: 'bot',
    code: 'ABCD',
    minPlayers: 2,
    startDelayMs: 0,
    resultsDelayMs: 0,
    matches: 0,
    reportsDir: '',
    reports: false,
    params: {},
    seed: 1,
    log: () => {},
  });
  return { client, connections: () => connections };
}

describe('BotClient reconnect', () => {
  it('does not reopen a socket when stopped during the reconnect backoff', async () => {
    const { client, connections } = await setup();
    const run = client.run();
    await delay(200); // connected, welcomed and dropped: the 500 ms resume timer is pending
    expect(connections()).toBe(1);
    client.stop();
    await run;
    await delay(800);
    expect(connections()).toBe(1);
  });

  it('connect() is a no-op once stopped', async () => {
    const { client, connections } = await setup();
    const run = client.run();
    await delay(200);
    client.stop();
    await run;
    const before = connections();
    (client as unknown as { connect(c?: string): void }).connect('ABCD');
    await delay(100);
    expect(connections()).toBe(before);
  });
});
