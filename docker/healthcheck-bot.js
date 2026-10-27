// Bot server container health check: GET /healthz on the bot server's own port (plain HTTP).
import http from 'node:http';

const port = process.env.BOT_PORT || 8090;
http
  .get({ host: '127.0.0.1', port, path: '/healthz', timeout: 4000 }, (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  })
  .on('error', () => process.exit(1))
  .on('timeout', function () {
    this.destroy();
  });
