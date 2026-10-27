// Container health check: GET /stats. The server is HTTPS when a certificate is configured (environment, config
// file or TLS_SELF_SIGNED) and plain HTTP otherwise, so try https first (certificate not verified: it may be
// self-signed) and fall back to http.
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

// The port is resolved like the server does: `server.port` of the config file (PARTY_GAME_CONFIG, or
// /etc/party-game/config.yaml when it exists) beats PORT, which beats 8080. Any problem reading the file falls
// back to PORT.
async function resolvePort() {
  try {
    const file = process.env.PARTY_GAME_CONFIG || '/etc/party-game/config.yaml';
    if (existsSync(file)) {
      const { parse } = await import('yaml');
      const port = parse(readFileSync(file, 'utf8'))?.server?.port;
      if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
    }
  } catch {
    /* use the environment */
  }
  return process.env.PORT || 8080;
}

const port = await resolvePort();
const probe = (lib, done) =>
  lib
    .get({ host: '127.0.0.1', port, path: '/stats', rejectUnauthorized: false, timeout: 4000 }, (res) => {
      res.resume();
      done(res.statusCode === 200);
    })
    .on('error', () => done(false))
    .on('timeout', function () {
      this.destroy();
    });
probe(https, (ok) => (ok ? process.exit(0) : probe(http, (ok2) => process.exit(ok2 ? 0 : 1))));
