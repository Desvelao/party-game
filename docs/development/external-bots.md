# External bots

`bot/` contains an AI player that connects to a running server over the normal WebSocket protocol, plus the reporting used to improve it. Full documentation (running it, report format, adding a game, in-server hosting options) is in [`bot/README.md`](../../bot/README.md).

- `bot/core`: the WebSocket client, report writer; the game-agnostic engine (brain, router, manager, watcher) is `src/plugins/bots/engine`, shared with the game server's bots plugin; each game's AI is in its pack (`src/games/<id>/bot`, the pack's `ai` export). The contract is `src/core/shared/ai.ts`.
- `npm run bot` plays, `npm run bot:analyze` summarises the reports in `bot/reports/`.
- It uses only the public protocol and types, never server code. It is separate from `npm run balance`, which simulates games offline.
- Difficulty levels (`easy` ... `semigod`) and ready-made rooms (bot vs human, bots vs human, level ladder, A/B of parameters) are run with `npm run bot:arena`; see the "Difficulty levels" and "Scenarios" sections of `bot/README.md`. With `--offline` the same scenarios run on the headless simulation, faster than real time, and write the same reports.
- `npm run bot:server` starts the companion server: it joins bots to open lobbies on its own (through the AI router in `bot/router`), shows them and their CPU/RAM in a dashboard and can write the same reports. Details in `bot/README.md`, section "Companion server".
- Embedding later: the router is pure logic and bots run through a small `BotRunner` interface (`bot/server/runner.ts`), so the main server or a game pack can host them in-process without changing the game AIs.
- The companion server exposes Prometheus metrics at `/metrics` (bots, per-bot / group / process / machine CPU and RAM, the game server's usage); see "Prometheus metrics" in `bot/README.md`.
- The companion is configured like the game server: a YAML file (`-c`), environment variables (file > env > default), `ADMIN_TOKEN` for its dashboard, and a live **Config** tab with an audit log. See "Configuration" in `bot/README.md`.
- Hosts can fill rooms with bots through the bots plugin (`docs/development/plugins.md`): it runs the bots inside the game server (`embedded`) or lets this server play them (`external`, token). See "Bots chosen by the host" in `bot/README.md`.
- Docker: the dev compose stack runs `bot:server` as the `bot` service; production has `docker/Dockerfile.bot` and the `bot` profile of `docker-compose.prod.yml`. See "Docker" in `bot/README.md`.
