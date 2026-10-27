// Finds out what a room plays without taking a seat: joins as a spectator, reads the selection from WELCOME, leaves.
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../../src/core/shared';
import type { ProbeResult } from '../../src/plugins/bots/engine/types';
export type { ProbeResult };



export function probeRoom(url: string, code: string, timeoutMs = 4000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let done = false;
    const finish = (r: ProbeResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close(1000);
      } catch {
        /* closed already */
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'JOIN_ROOM', v: PROTOCOL_VERSION, name: 'Scout', code, spectate: true })));
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (m.t === 'WELCOME') finish({ ok: true, selection: m.selection, maxPlayers: m.config?.maxPlayers ?? 0 });
        else if (m.t === 'ERROR') finish({ ok: false, error: m.code });
      } catch {
        finish({ ok: false, error: 'bad message' });
      }
    });
    ws.on('error', (e) => finish({ ok: false, error: e.message }));
    ws.on('close', () => finish({ ok: false, error: 'closed' }));
  });
}
