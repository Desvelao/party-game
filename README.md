# Bonk Arena Party

Lightweight, server-authoritative multiplayer party game for browsers. Phaser 3 + Vite client,
Node.js + `ws` server, JSON protocol. Designed to run on small ARM boards (Pi Zero W → Pi 4 / Orange Pi).

> **Status: 0.1.0, the first public release.** The game is playable, but versions before 1.0 may change settings, the profile format or the plugin contract between minor releases; see [CHANGELOG.md](CHANGELOG.md).

> Contributing? Read [CONTRIBUTING.md](CONTRIBUTING.md). Using an AI agent? See [AGENTS.md](AGENTS.md) for development guidelines.

## Features

- **User manual**: [docs/manual/](docs/manual/README.md) covers installation, deployment, configuration, administration and playing.
- Rooms with 4-letter codes, shareable invite / watch links, spectators and reconnect-to-seat.
- Eight minigame families with 27 variants (Ballistix, Frost Shove, Spring Showdown, Box Bonanza, Crazy Logs, Sprint Smash, Tank Wars, Rumble Cards),
  each with host-adjustable options; play one game, all variants in order, mixed, or a **custom playlist**.
- **Host controls**: kick, hand over host, lock the room, cap players, change game, reset a name.
- **Plugins**: optional features installed like games (`docs/development/plugins.md`). The bots plugin lets a host fill a room with AI players, pick their level and add single bots; they run inside the server or in the separate bot server (`bot/README.md`). The `characters` plugin provides the Blob character model most games draw their players with, the `leaderboard` plugin is the public ranking page, the `prometheus` plugin serves `GET /metrics`, the `transfer` plugin moves a profile to another device with a QR / one-time code, and the `progression` plugin adds XP, levels, win streaks, achievements and best places to the profile. What else could become a plugin: `docs/development/core-extraction-report.md`.
- **Player profiles** (no accounts): name, preferred colour, customizable character, stats, saved variants and
  playlists, and language, stored on the server.
- English, Spanish, French, German, Portuguese and Italian UI, phone-friendly controls (joystick or 4-way cross, per game; shown automatically on touch screens, opt-in elsewhere), `/rooms` and `/status` pages for operators.
- Configured with a YAML file and/or environment variables; ships as a multi-arch Docker image.

## Dev environment (Docker Compose)

```bash
docker compose up                  # game: http://localhost:5173  (phones: http://<LAN-IP>:5173)
                                   # server stats: http://localhost:8080/stats
                                   # bot server (AI players for open lobbies): http://localhost:8090 (token: ADMIN_TOKEN, default dev-stats)
docker compose run --rm loadtest   # 8 bots, 1 room, 30 s (override: LOADTEST_ARGS="--players 16 --rooms 2 --duration 60")
docker compose run --rm --no-deps server npm test
docker compose run --rm --no-deps server npm run typecheck
docker compose run --rm --no-deps server npm run check   # typecheck + tests
```

### npm scripts and CLI tools

| Script | Purpose | Needs a running server | In the prod image |
|---|---|---|---|
| `npm run check` | typecheck + tests (what CI runs) | no | no |
| `npm run loadtest` | bots play real matches and report server load (`--help` lists options) | yes | `node dist/loadtest.js` |
| `npm run dev:server:built` | the dev server started from built packs (`dist/`) instead of the sources, to check the real pack path | no | no |
| `npm run build:games` | build the packs under `src/games/` and install them into `dist/games` (`GAMES=none` for an empty core, `GAMES=id,id` for a subset) | no | no |
| `npm run balance` | seeded bot playtests of every variant: duration, spawn-slot bias, skill gap ([docs/development/balance-testing.md](docs/development/balance-testing.md)) | no | no |
| `npm run admin` | operator CLI over the admin API | yes | `node dist/admin.js` |
| `npm run profiles:migrate` | copy player profiles between storage drivers | no | `node dist/migrate-profiles.js` |
| `npm run games` | install, list and uninstall game packs (`--help` lists commands) | no | `node dist/games.js` |
| `npm run gamepack` | create, build and check a game pack (for game authors) | no | no |
| `npm run scaffold` | scaffold a game pack (server, config, test stub, translations) or add a variant to one (for game authors) | no | no |
| `npm run playtest` | play one seeded round headless with the inputs of a JSON script (for game authors) | no | no |
| `npm run config:check` | validate the config and print effective values with sources | no | `node dist/config-check.js` |
| `npm run config:example` | regenerate `config.example.yaml` | no | no |
| `npm run build:tools` | bundle the CLI tools above into `dist/` | no | n/a |

### Dev workflow: what needs what

| You change | Do |
|---|---|
| anything under `src/core/` | **nothing**: `tsx watch` restarts the server, Vite hot-reloads the client |
| a game under `src/games/` | `docker compose restart server` (the server packs the games each time it starts; reload the page to get the new client code) |
| `package.json` | `docker compose restart` (the entrypoint runs `npm install` when it changed), or `docker compose up --watch` to do it automatically |
| `docker/` or `docker-compose.yml` | `docker compose up --build` |

Notes:
- A server restart clears all rooms (state is in memory by design); the client says so and tells you when the server is back. Player profiles survive restarts (`data/`, git-ignored).
- Running tests outside the container needs Node >= 18 (Vitest). `npm run check` (typecheck + tests) must be green; CI (`.github/workflows/ci.yml`) runs it on every push and pull request, plus the production build, the `config.example.yaml` check and a dependency audit (also weekly). Pushing a `vX.Y.Z` tag publishes a GitHub release with a tarball (`release.yml`) and the container image.
- Containers run as the unprivileged `node` user (uid 1000), so `node_modules/` and anything built into `dist/` belong to your user. If they are root-owned from an older setup, **stop the stack first**: `docker compose down && sudo rm -rf node_modules dist && docker compose up --build`.
- **Troubleshooting:** the client says "Disconnected - the server restarted or is unreachable", Vite logs `ECONNREFUSED ...:8080`, or the server log shows `Cannot find module .../tsx`? The containers were created before a config / `node_modules` change (or `node_modules` was deleted under a running container). Recreate them: `docker compose down && docker compose up --build`.
- No inotify (Docker Desktop, WSL, network mounts)? `WATCH_POLLING=1 docker compose up`. The Vite client already polls by default (it missed edits made on the host); `WATCH_POLLING=0` switches that off.

Pick a hardware profile / override limits with env vars:

```bash
PROFILE=LOW_POWER docker compose up        # LOW_POWER | NORMAL | HIGH
PROFILE=HIGH MAX_ROOMS=8 TICK_RATE=60 NET_RATE=30 docker compose up
```

## Configuration

Every setting can come from the config file, an environment variable, or the hardware profile default
(see precedence below). Durations in the file are whole seconds.

| File key | Env var | Default | Notes |
|---|---|---|---|
| `server.host` | `HOST` | `0.0.0.0` | |
| `server.port` | `PORT` | `8080` | |
| `server.staticDir` | `STATIC_DIR` | `dist/client` | built client |
| `server.tlsCert` / `server.tlsKey` | `TLS_CERT` / `TLS_KEY` | empty | PEM certificate and private key files; both set serves the page and `wss` over HTTPS on the same port (only one set stops the start-up with a message; both empty: plain HTTP). In Docker, `TLS_SELF_SIGNED=1` creates a self-signed pair; see [docs/manual/https.md](docs/manual/https.md) |
| `server.publicUrl` | `PUBLIC_URL` | empty | public address used in the join link of the `/qr/<ROOM>` QR code and the captive-portal redirect (e.g. `http://partygame.local`); empty = the `Host` the request used |
| `server.captivePortal` | `CAPTIVE_PORTAL` (`1`/`true`/`yes`) | `false` | party-box mode: answer the connectivity checks of phones and send unknown host names to the game ([docs/party-box.md](docs/party-box.md)) |
| `server.consoleMode` | `CONSOLE_MODE` (`1`/`true`/`yes`) | `false` (off) | console mode: the TV page `/tv` owns a room and shows a PIN; a phone that types it at `/console` hosts the room and can use the admin page ([docs/party-box.md](docs/party-box.md)) |
| `server.consoleScreenAny` | `CONSOLE_SCREEN_ANY` (`1`/`true`/`yes`) | `false` | console mode, development only: let any address open the TV room (by default only the machine itself can, so nobody on the Wi-Fi can take it over and read the PIN) |
| `server.trustProxy` | `TRUST_PROXY` (`1`/`true`/`yes`) | `false` | use the last `X-Forwarded-For` entry (the one your proxy appended) as the client address; only behind a single proxy you control, which must append the peer address |
| `server.adminInsights` | `ADMIN_INSIGHTS` (`0`/`1`) | `true` | keep the match history, player reports and metrics time series behind the admin History/Health tabs; `false` skips them (less memory and disk on tiny boards) and their endpoints answer 404 |
| `server.adminToken` | `ADMIN_TOKEN` | empty | bearer token for `/api/admin/*` and `/stats?reset=1` (empty: loopback only; never loopback behind a proxy header) |
| `performance.profile` | `PROFILE` | `NORMAL` | `LOW_POWER` \| `NORMAL` \| `HIGH`: base for the next five |
| `performance.tickRate` | `TICK_RATE` | 60 (30 on `LOW_POWER`) | 10-120 Hz |
| `performance.networkRate` | `NET_RATE` | 20 (15 / 30) | snapshots per second, 1-60 |
| `performance.maxRooms` | `MAX_ROOMS` | 4 (2 / 8) | 1-64 |
| `performance.maxPlayersPerRoom` | `MAX_PLAYERS` | 8 (8 / 16) | 1-32 |
| `performance.maxSpectatorsPerRoom` | `MAX_SPECTATORS` | 8 (4 / 16) | 0-64 |
| `game.idleRoomSeconds` | `IDLE_ROOM_SECONDS` | `600` | close idle lobbies; 0 = never |
| `game.roomRestoreSeconds` | `ROOM_RESTORE_SECONDS` | `900` | after a restart, bring back lobbies saved less than this long ago; 0 = rooms are not kept |
| `game.idleWarnSeconds` | `IDLE_WARN_SECONDS` | `60` | warn players this long before an idle room closes (at most half of `idleRoomSeconds`); 0 = no warning |
| `game.hostIdleSeconds` | `HOST_IDLE_SECONDS` | `90` | a host who does nothing this long (outside a running round) while another player is active passes the host role on; 0 = never |
| `game.reconnectGraceSeconds` | `RECONNECT_GRACE_SECONDS` | `60` | seat kept for a dropped player; 0 = off |
| `limits.joinTimeoutSeconds` | `JOIN_TIMEOUT_MS` (ms) | `10` | close sockets that never join; 0 = off |
| `limits.pingIntervalSeconds` | `PING_INTERVAL_MS` (ms) | `30` | liveness ping; 0 = off |
| `limits.maxConnectionsPerIp` | `MAX_CONNECTIONS_PER_IP` | `50` | 0 = unlimited |
| `plugins.leaderboard.top` | `LEADERBOARD_TOP` | `20` | leaderboard plugin (the public `/leaderboard` page and `GET /api/leaderboard`; leave `leaderboard` out of `plugins.enabled` to turn it off): players listed, 1-100; needs a restart |
| `plugins.dir` | `PLUGINS_DIR` | empty | plugins you installed with `npm run plugins -- install` (empty: a `plugins` folder inside the data folder) |
| `plugins.bundledDir` | `BUNDLED_PLUGINS_DIR` | `dist/plugins` | plugins that come with this build |
| `plugins.enabled` | `PLUGINS` | `all` | which plugins load: `all`, `none` or a list of ids (`[bots]` in the file, `bots,other` in the variable) |
| `plugins.bots.allowFill` | `BOTS_ALLOW_FILL` | `false` | the bots plugin: hosts may fill their room with bots and add bots of a chosen level |
| `plugins.bots.defaultLevel` | `BOTS_DEFAULT_LEVEL` | `normal` | level new rooms start with: `easy` / `normal` / `hard` / `expert` / `semigod` / `random` |
| `plugins.bots.mode` | `BOTS_MODE` | `embedded` | `embedded`: this server plays the bots; `external`: the separate bot server does |
| `plugins.bots.token` | `BOTS_TOKEN` | empty | secret the bot server (`GAME_SERVER_BOT_TOKEN`) presents in `JOIN_ROOM {plugin}`; empty = embedded bots only |
| `plugins.bots.maxBots` | `BOTS_MAX` | `0` | most embedded bots at once; 0 = by `PROFILE` (2 / 8 / 16) |
| `plugins.bots.decisionHz` | `BOTS_DECISION_HZ` | `0` | embedded bot decisions per second; 0 = by `PROFILE` (10 / 20 / 30) |
| `plugins.bots.mixed` | `BOTS_MIXED` | `never` | `never` / `always`: bots in rooms that rotate through every game (every built-in game has a bot player; they sit out the rounds of installed games without one) |
| `plugins.bots.playlistJoin` | `BOTS_PLAYLIST_JOIN` | `any` | custom playlists: bots join when they can play `any` game of it, or only if they can play `all` |
| `plugins.bots.idleLeaveSeconds` | `BOTS_IDLE_LEAVE_SECONDS` | `120` | seconds a bot may sit out before it leaves; `0` = never |
| `plugins.bots.namePrefix` | `BOTS_NAME_PREFIX` | `Bot` | start of the bots' names (up to 8 letters) |
| `plugins.bots.api` | `BOTS_API` | `true` | management API at `/api/bots` (admin token) |
| `plugins.bots.dashboard` | `BOTS_DASHBOARD` | `true` | dashboard page at `/plugins/bots/` (needs `api`) |
| `plugins.bots.liveConfig` | `BOTS_LIVE_CONFIG` | `true` | change the settings that apply here from the dashboard |
| `plugins.bots.audit` | `BOTS_AUDIT` | `true` | log of who changed what through the management API |
| `plugins.prometheus.enabled` | `METRICS_ENABLED` | `false` | prometheus plugin: serve `GET /metrics` behind the admin token (loopback-only without one); nothing is served while off |
| `plugins.bots.metrics` | `BOTS_METRICS` | `false` | Prometheus metrics at `/api/bots/prometheus` (admin token) |
| `plugins.bots.reports` | `BOTS_REPORTS` | `false` | write a report of every bot match (files are written on the game loop: leave off on small machines) |
| `plugins.bots.reportsDir` | `BOTS_REPORTS_DIR` | empty | folder of those reports (empty: the plugin's data folder) |
| `branding.name` | `BRAND_NAME` | `Party Game` | product name shown in the menu and browser title, up to 40 characters; live-editable in the admin Config tab |
| `branding.welcomeMessage` | `WELCOME_MESSAGE` | _(empty)_ | main-menu tagline, up to 140 characters; empty keeps the built-in translated one; live-editable |
| `storage.store` | `PROFILE_STORE` | `json` | `json` \| `sqlite` \| `memory` (lost on restart) |
| `storage.maxProfiles` | `MAX_PROFILES` | `10000` | guards the store against junk keys |
| `storage.recentMatches` | `RECENT_MATCHES` | `10` | past matches each profile keeps (0 = none, max 50) |
| `gamePacks.dir` | `GAMES_DIR` | empty | folder of games installed with `games install` (empty: `games` inside `storage.json.dataDir`) |
| `gamePacks.bundledDir` | `BUNDLED_GAMES_DIR` | `dist/games` | games built into this version |
| `storage.json.dataDir` | `DATA_DIR` | `data` | `json` driver: directory of `profiles.json` |
| `storage.sqlite.path` | `SQLITE_PATH` | `data/profiles.db` | `sqlite` driver: database file (directory is created) |
| `storage.sqlite.busyTimeoutSeconds` | `SQLITE_BUSY_TIMEOUT_MS` (ms) | `5` | `sqlite` driver: wait for a locked database |

Settings that only one storage driver uses sit in a subgroup named after it (`storage.json`, `storage.sqlite`);
a subgroup for a driver that is not selected is validated and ignored.

### Configuration file

Server settings can live in a YAML file grouped like the table above
(copy [`config.example.yaml`](config.example.yaml); every key is optional).

```bash
node dist/server.js -c ./config.yaml        # or: npm start -- -c ./config.yaml
```

- **Which file:** `-c/--config <file>`, else `$PARTY_GAME_CONFIG`, else `/etc/party-game/config.yaml` if it exists.
  A file named by the flag or the variable must exist; with none, the server runs from the environment as before.
- **Precedence:** config file > environment variable > hardware profile default. Unknown sections/keys and
  out-of-range values stop startup with a one-line message naming the key (e.g. `performance.maxRoom`).
- **Units:** every duration in the file is in whole seconds (`limits.joinTimeoutSeconds`, `game.idleRoomSeconds`, ...);
  the environment variables `JOIN_TIMEOUT_MS` / `PING_INTERVAL_MS` stay in milliseconds.
- **Docker:** mount the file at `/etc/party-game/config.yaml` (see the commented line in `docker-compose.prod.yml`).
- **Check without starting:** `npm run config:check -- -c ./config.yaml` (built: `node dist/config-check.js -c ./config.yaml`)
  prints every effective value with its source (file, env or default) and exits non-zero on an error.

## Player profiles

A profile holds the player's name, preferred colour, one look per character model (the models come from the games and
plugins, see "Character models" in `docs/development/game-packs.md`) and the model shown as their avatar, UI language, saved variants/playlists and server-computed stats (matches, wins, points, per-minigame results).
There are no accounts: the browser generates a secret **profile code** (shown in *Profile → Info*, copy it to
continue on another device) and the server stores the profile under its SHA-256, never the code itself.

- **Controls**: *Menu → Controls* (or *Profile → Controls*) rebinds the keyboard (two keys per action, browser/modifier keys are refused; Ctrl/Meta/Alt combinations are never sent to the game). Saved in the profile for registered players, in `sessionStorage` for guests (this tab only), cached in `localStorage` otherwise.
- **Menu → My profile** (or the *Profile* nav link, `/?view=profile`): info, stats, customize, presets.
- **API**: `GET /api/profile` returns `{profile}` (`null` if none yet); `PUT /api/profile` merges `name`, `color`,
  `looks` (per character model: `{ "<model>": { "<slot>": <option index> } }`; the models named replace their saved look, others are kept), `avatar` (a model id, `""` clears it), `lang`, `presets`, `controls` (rebound keyboard keys, re-validated; absent = defaults), `touch` (on-screen control preferences: `show` auto/on/off, `move` auto/joystick/cross, `perGame` overrides; absent = defaults). Both need `Authorization: Bearer <profile code>`; bodies are capped at 16 KB and the API is
  rate limited per IP. Everything is re-validated server-side.
- **Moving a profile to another device**: the profile tab offers the code and a recovery link (`/#recover=<code>`, the code stays in
  the URL fragment). The transfer plugin (`src/plugins/transfer`) adds a QR / one-time transfer code: `POST /api/transfer`
  (`{ "key": <profile code> }`) issues an 8-letter code valid 5 minutes and single use (in memory, lost on restart);
  `GET /api/transfer?code=` trades it for the code. Opening `/#transfer=<code>` or pasting a code or link into "Use another
  code" adopts the profile.
- **Join**: the client sends the code as `profileKey` in `JOIN_ROOM`; the server then seats the player with their
  saved colour (when free in the room) and looks, and credits game and match results to the profile.
- **Storage** is behind the `ProfileRepository` interface (`src/core/server/profiles/ProfileRepository.ts`); the driver
  is chosen with `storage.store`:

  | Driver | Use it for | Notes |
  |---|---|---|
  | `json` (default) | any platform, existing installs | one `profiles.json` (atomic writes, whole file in memory); zero dependencies, so it works on every board |
  | `sqlite` | recommended persistent store | one SQLite database (WAL mode, a single `profiles` table); much less SD-card writing than rewriting a JSON file |
  | `memory` | tests, throwaway servers | lost on restart |

  `sqlite` needs the optional `better-sqlite3` module (native; prebuilt for amd64, arm64 and armv7). Where it cannot
  be installed (arm/v6, e.g. Pi Zero W) the server still runs, and selecting `sqlite` stops startup with
  `SQLite driver unavailable on this platform ...; use storage.store: json`.
  The store is opened before the server listens, so a bad path or a locked/corrupt database fails at startup with
  one line instead of on the first join.
- **Switching drivers**: change `storage.store`, then copy the data once (safe to repeat):
  `npm run profiles:migrate -- --from json --to sqlite -c config.yaml` (the settings of both drivers come from the
  configuration). The production image has no `src/` or `tsx`; it ships the tool bundled as `dist/migrate-profiles.js`
  (the admin CLI is `dist/admin.js`). Stop the game first, then run it against the data volume:
  `docker compose -f docker-compose.prod.yml run --rm game node dist/migrate-profiles.js --from json --to sqlite`
  (the service's `PROFILE_STORE`/`SQLITE_PATH` and the `party-game-data` volume apply), then set `PROFILE_STORE=sqlite`
  and start it again. Without this step a container switched to sqlite starts with an empty database.
  `PROFILE_STORE=file` is still accepted as an alias for `json` (with a warning).
- **Adding a driver** (e.g. a network database): implement `ProfileRepository` (and `MigratableRepository` for the
  migrate tool), add a case in `createProfileRepository` (`profiles/index.ts`), add its settings to the `SETTINGS`
  table in `config.ts` under `storage.<name>`, and run it through the contract suite in `profiles/repository.test.ts`.
  The record logic (`profiles/profile.ts`: sanitizing, stats merging) is shared and storage-independent.

## Rooms, host controls and playlists

Creating a room picks a game, a variant (or *all variants* / *mixed*) and optional **Advanced options**. A
**custom playlist** (up to 10 rounds) lets the host choose any game and variant per round, each with its own options;
the match runs exactly those rounds. Players can save a configured variant ("Fast Pogo") or a whole playlist to their
profile and reuse it when creating a room (*Profile → Presets* manages them).

The host sees **Room controls** in the lobby and action buttons on every other player's entry:
make host, reset name, kick (two clicks to confirm), plus lock the room, set the player cap and change the game or
playlist before the match starts. With the bots plugin enabled (`BOTS_ALLOW_FILL=1`) the panel also fills the room with AI players of a chosen level and adds single bots. Kicking also works on spectators and mid-match; a kicked seat cannot be resumed.

## Monitoring pages

| Path | What |
|---|---|
| `/stats` | JSON: profile, rates, rooms, clients, tick-loop timing, network counters, process CPU/RAM. `?reset=1` starts a new measurement window (needs `ADMIN_TOKEN`, or loopback) |
| `/status` | public, minimal: rooms, clients, uptime, version (`?format=json`). Host CPU/RAM/load/temperature, ping, tick loop and network counters live in the admin panel's Health tab (`/api/admin/status`) |
| `/rooms` | open rooms (`?format=json`) |
| `/api/rooms` | public room browser: open lobbies whose host listed them (JSON, rate limited) |
| `/profile` | player profile (client view) |
| `/room/<ID>` | join a room; `?spectate=1` to watch, `?password=<pw>` for a password-protected room (the host's share buttons include it). Old `/?room=<ID>` links still work |
| `/admin` | operator page: live rooms, kick/ban, profiles, settings, games, history, health (needs `ADMIN_TOKEN`; see below) |

## Administration

The server has an operator interface with three front ends over one API: the `/admin` page,
`npm run admin -- <command>` and plain HTTP under `/api/admin/*`. It covers live rooms (close, lock,
notice, kick, ban by IP or profile), profile search/edit/export/import, changing limits without a restart,
switching games or variants off, match history, leaderboards and a ten-minute health chart.

Set `ADMIN_TOKEN` (without it only the machine itself can use the admin API, which in
Docker means nobody). In the dev stack open `http://localhost:5173/admin` and sign in with `dev-stats`.
Full reference: [docs/admin-api.md](docs/admin-api.md).

## Production (Docker)

A multi-arch image (amd64, arm64, arm/v7, arm/v6) is built by the **Docker image** GitHub Actions workflow and
published to `ghcr.io/<owner>/<repo>`: push a `v*` tag (e.g. `v0.1.0` publishes `0.1.0`, `0.1`, `latest`), or run it
by hand from the Actions tab (choose platforms and an optional extra tag).

```bash
docker run -d --name party-game --init -p 8080:8080 -v party-game-data:/app/data \
  -e PROFILE=LOW_POWER ghcr.io/<owner>/<repo>:latest

# or with compose (set IMAGE=ghcr.io/<owner>/<repo>; --build builds from this checkout instead of pulling)
docker compose -f docker-compose.prod.yml up -d
```

The bot server (`docker/Dockerfile.bot`, published as `ghcr.io/<owner>/<repo>-bot`) is the optional `bot` service of the same
compose file: set `BOT_ADMIN_TOKEN` (required) and start it with `docker compose -f docker-compose.prod.yml --profile bot up -d`;
the dashboard is on port `8090` (`BOT_PORT`). It is published in both flavors like the game image (`-bot` tags `X.Y.Z` and
`X.Y.Z-bare`; the bare one has no built-in game AI, install game packs into its data volume), and as native packages
(`party-game-bot...` tar.gz, deb, rpm for every architecture; see `docs/manual/deployment.md`). See [bot/README.md](bot/README.md).

### Deploying with compose

1. Create a `.env` file next to `docker-compose.prod.yml` (all keys optional except `IMAGE` unless you use `--build`):

   ```bash
   IMAGE=ghcr.io/<owner>/<repo>   # the compose default is a placeholder (ghcr.io/OWNER/party-game)
   TAG=latest                     # pin a release, e.g. 0.1.0, for repeatable deploys
   PORT=8080                      # host port
   PROFILE=NORMAL                 # LOW_POWER | NORMAL | HIGH
   ADMIN_TOKEN=<long random string>
   PROFILE_STORE=sqlite           # json (default) | sqlite
   # TRUST_PROXY=1                # only behind a reverse proxy you control
   ```

   Without `ADMIN_TOKEN` the admin API only answers on loopback, which inside Docker means
   nobody. Generate tokens with `openssl rand -hex 24`.
2. Start it: `docker compose -f docker-compose.prod.yml up -d` (or add `--build` to build from this checkout).
3. Check it: `docker compose -f docker-compose.prod.yml ps` should show `healthy`, and
   `curl http://localhost:8080/stats` should return JSON. Players join at `http://<host>:<PORT>/`.
4. Upgrade: `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`.
   Roll back by setting `TAG` to the previous version. The `party-game-data` volume survives both.

- Configure it with the env vars above (`PROFILE`, `TICK_RATE`, `MAX_ROOMS`, ...; `docker-compose.prod.yml` lists
  them all) or a mounted config file (uncomment the `./config.yaml` mount in the compose file; values in the file
  win over env vars, see *Configuration file*).
- Behind your own reverse proxy set `TRUST_PROXY=1` and make sure the proxy forwards WebSocket upgrades
  (`Upgrade` / `Connection` headers) to the same port.
- Back up the data volume with e.g.
  `docker run --rm -v party-game-data:/data -v "$PWD":/backup alpine tar czf /backup/party-game-data.tgz -C /data .`
- Player profiles and stats are stored in `/app/data` (a volume): keep it to preserve them across upgrades. Set
  `PROFILE_STORE=sqlite` to use the SQLite driver (the database lands in the same volume).
- The container runs as the unprivileged `node` user, has a healthcheck on `/stats`, and the compose file also
  makes the root filesystem read-only and drops all capabilities.
- Build locally: `docker build -t party-game .` (single platform), or `docker buildx build --platform linux/arm64 .`.

## Running without Docker (production / Pi)

The game box needs just Node 18+:

```bash
npm install && npm run build
PROFILE=LOW_POWER PORT=80 npm start   # serves client + websocket on one port
npm start -- -c ./config.yaml         # or configure with a file (see Configuration)
```

The process needs write access to `DATA_DIR` (default `./data`) for player profiles.

### Native packages (no Node.js needed)

Each release also has self-contained packages for amd64, arm64, armv7 and armv6 (Raspberry Pi Zero W): a `tar.gz`, a
`deb` and an `rpm`, all with their own Node.js. The deb/rpm install a `party-game` systemd service (user `party-game`,
config in `/etc/party-game/`, data in `/var/lib/party-game`) and the commands `party-game-server`, `-admin`,
`-config-check`, `-loadtest`, `-migrate-profiles`, `-games` and `-plugins`. Every package also exists as a **bare**
flavor (`-bare` in the name: no games or plugins) and the games and plugins are attached to the release as `.pgpack` files to
install into it; the container image has the same split (`:latest` full, `:latest-bare`). See the user manual
([installation](docs/manual/installation.md#option-3-linux-package-deb-rpm-or-tarball),
[deployment](docs/manual/deployment.md#production-with-the-linux-package)); how they are built is in
[docs/development/packaging.md](docs/development/packaging.md).

## Layout

The repository has two halves: `src/core` is the engine and contains no game, and `src/games` holds one
folder per game. Every game is a pack that the server loads at start-up (see "Adding a game").

```
src/
  core/
    shared/    protocol, types, constants, catalog (what hosts can pick, playlists; empty until packs register
               their games), guides (the shape of a how-to-play guide), character (the character model registry,
               look validation and the shapes a model draws; the core ships no model), profile + presets (record types and validation), plugin-api + manifest
               (the contract between the core and a game pack), kit/ (small helpers a pack may bundle:
               util, collision, shapes), i18n + locales/ (en, es, fr, de, pt, it)
    server/    config.ts (settings table, env + profile defaults), configFile.ts (YAML + -c flag),
               networking (+ limits: connection caps, token buckets; nav.ts, system.ts for /status), rooms (host
               controls live in Room.ts), profiles/ (ProfileRepository + json/sqlite/memory stores), game loop,
               plugins/ (pack format, game + plugin loaders, installer), minigames/ (the registry the packs fill)
    client/    Vite + Phaser (src/scenes: GameScene shell that draws any game through its plugin), networking,
               ui, input, audio; plugins/ loads the client code of each pack; flow.ts, keycapture.ts and panel.ts
               hold small, unit-tested UI decision logic; profile.ts / presets.ts talk to /api/profile;
               ui/screens.ts has the lobby, profile and playlist views
    tools/     admin.ts (admin API command-line client, `npm run admin`), gen-config-example.ts (regenerates
               the games section of config.example.yaml, `npm run config:example`), loadtest.ts (load test),
               balance.ts + balance/ (bot playtesting simulator, `npm run balance`), gamepack.ts + games.ts
               (create, build, install packs), plugins.ts + build-plugins.ts (install plugins, `npm run plugins`), migrate-profiles.ts (copy profiles between storage drivers)
  games/       one folder per game pack: game.json + server/ + client/ (+ shared/); built by `npm run build:games`
    ballistix/  sprint-smash/  box-bonanza/  crazy-logs/  spring-showdown/  frost-shove/  rumble-cards/  tank-wars/
  plugins/     one folder per plugin: plugin.json + server/ + client/ (+ engine/); built by `npm run build:plugins`
    bots/      AI players: lobby controls, room state and the engine shared with the bot server (bot/)
templates/game, templates/plugin   scaffolds for `npm run gamepack -- init [--kind plugin]`
docker/      dev image + entrypoint
packaging/   native packages: launcher template, systemd unit, maintainer scripts, build-package.sh
config.example.yaml   documented server configuration (all defaults)
data/        profiles.json / profiles.db (created at runtime, git-ignored)
Dockerfile   production image (multi-stage, multi-arch); docker-compose.prod.yml runs it
.github/     workflows/docker-image.yml builds and publishes it
```

## Adding a game

Every game is a pack, and the core has none built in (see [docs/development/game-packs.md](docs/development/game-packs.md)
for the format and the contracts). `npm run gamepack -- init my-game` creates `src/games/my-game/` with the server
simulation, the client renderer and `game.json` (catalog, guide, options, translations). `npm run build` bundles every
folder under `src/games/` into a pack and installs it into `dist/games`; `GAMES=none npm run build` builds a core with
no games, to fill later with `npm run games -- install`.

1. **Simulation** (`server/`): implement `Minigame` (`src/core/shared/plugin-api.ts`) and export a `ServerGamePlugin`
   from `server/index.ts`. Reuse `src/core/shared/kit/util.ts` (`clamp`, `pick`, `mulberry32`, `LastStandingTracker`...)
   and take the random source as an injectable `rng: () => number = Math.random` so tests can be deterministic. A
   `bot` on the plugin gives `npm run balance` a greedy player.
2. **State**: the snapshot's `kind` is `ext:<game id>`, and its types live in `shared/types.ts` of the pack as plain
   `type`s (no `interface`) so they are assignable to the core's `ExternalState`.
3. **Catalog** (`game.json`): `catalog` has the game, its variants and options, and `tags` from the fixed vocabulary (`GAME_TAGS`). Every game and variant needs `name`,
   `description`, an `action` (`ActionKind`: the button label) and a `guide` (`{objective, rules, items?}` as
   `{en, es, fr, de, pt, it}`). Each option has a `group` (`match`, `player`, `abilities`, `spawns`, `powerups` or `hazards`), and
   its defaults must equal the server config (the pack tests check it).
4. **Translations**: catalog texts are English in the data, so `locales` of `game.json` (`es`, `fr`, `de`, `pt`, `it`) maps every description,
   option `label`/`description`, `zeroLabel` and choice label (and every `ctx.tr()` text of the client) to each language
   (`src/core/shared/i18n.test.ts` fails on missing ones). Generic HUD words come from the core's `ctx.t()` keys. Game and
   variant names are not translated.
5. **Client** (`client/`): export a `ClientGamePlugin` with a renderer (it draws on `host.g`, never imports Phaser) and,
   as needed, `hud`, `cue`, `event`, `ranking`, `music`, `moveControl`.
6. **Player limit** (if the game only works up to N players): set `maxPlayers: N` on the catalog game (a variant's
   own `maxPlayers` overrides it). It is published in `publishedSettings()` and enforced by the room: a room on
   that game or playlist is capped at N and cannot take more; changing the game or pressing Start with more
   players seated is refused (`TOO_MANY_PLAYERS`, the lobby shows why); Mixed / All-variants rotations skip the
   rounds that do not fit. Ballistix is `maxPlayers: 4` (one side each).
7. **Teams**: set `teams: true` and `maxTeamSize: N` on the catalog game (a variant's own values override them).
   The host can then switch the room to team play in the lobby (`ROOM_SETTINGS {teams}`); players pick a team with
   `SET_TEAM`, teams are capped at the strictest `maxTeamSize` of the selection, and a selection only offers teams
   when every round supports them. The simulation stays per-player: the room sums the members' points per team and
   gives the best team's members the round win. Ballistix is `maxTeamSize: 2`, the other families 4.
8. **Order**: `order` in `game.json` sets where the game appears in the picker and in Mixed rotations (lower first).

Lobby, networking, countdown, scoring, results and profile stats (keyed by the playable id) need no changes. The tests of
a game live next to its code; `src/core/test-setup.ts` registers every game under `src/games/` for the whole test run.

## Protocol

JSON over WebSocket at `/ws`, versioned (`PROTOCOL_VERSION`). Client sends *intentions only*
(`INPUT {mx,my,a1,a2}`); the server owns positions, collisions, timers, scores and winners.
Client → server: `JOIN_ROOM` (name, room code or game selection / `playlist`, `spectate`, `resume`, `profileKey`, `password`),
`JOIN_AS_PLAYER`, `READY`, `START_GAME`, `INPUT`, `NEXT_GAME`, `REMATCH`, `BACK_TO_LOBBY` (host: everyone back to the lobby), `VOTE_START`, `VOTE`, `PING`, and the
host-only `KICK`, `MAKE_HOST`, `RESET_NAME`, `ROOM_SETTINGS {locked?, maxPlayers?, teams?, password?, lateJoin?, catchUp?}`, `PLUGIN_ACTION {plugin, data}`, `SET_TEAM {team, id?}`, `EMOTE {emote}`, `SET_SELECTION`.
Server → client: `WELCOME`, `ROOM_UPDATE` (players with colour + looks + avatar, host, selection, watchers, locked,
maxPlayers, passwordProtected), `ROOM_PASSWORD` (host only), `PLAYER_JOINED`, `PLAYER_LEFT`, `GAME_START`, `GAME_STATE`, `GAME_EVENT`, `GAME_RESULT`,
`SCORE_UPDATE`, `MATCH_FINISHED` (ranking, plus the optional `mvp` and per-round `rounds` recap), `VOTE_UPDATE`, `ERROR {code}` (`BAD_VERSION ROOM_NOT_FOUND ROOM_CLOSED ROOM_FULL
ROOM_BUSY ROOM_LOCKED PASSWORD_REQUIRED WRONG_PASSWORD KICKED SERVER_FULL NOT_HOST NOT_READY VOTE_ACTIVE VOTE_COOLDOWN BAD_STATE`), `PONG`.
New optional fields and messages are additive, so `PROTOCOL_VERSION` has not changed.

Hardening: 8192 B max frame (`ws maxPayload`, `MAX_MESSAGE_BYTES`; room for a 10-round playlist), per-connection token buckets
(general 90 burst / 60 per s, separate INPUT bucket 120 / 90 per s; violations are strikes that decay 0.5/s and
close the socket above 50), strict message validation, host-only transitions, phase checks, name sanitising,
slow-client frame dropping. A socket must JOIN within `limits.joinTimeoutSeconds` (10) and answer ws pings sent every
`limits.pingIntervalSeconds` (30); `limits.maxConnectionsPerIp` (50) caps sockets per client (`server.trustProxy`
uses the last `X-Forwarded-For` entry, only behind a trusted proxy); lobby/finished rooms idle for `game.idleRoomSeconds` (600)
are closed; `/stats?reset=1` needs `ADMIN_TOKEN` (loopback-only when unset). A room whose update throws is closed
instead of taking the server down. Setting a timeout/cap to 0 turns it off. Host-only messages are checked against the current host server-side.

Reconnect: `WELCOME` carries an optional `resume` token (128-bit hex, sent only to its owner, never in
`ROOM_UPDATE`). A client that dropped mid-match can send `JOIN_ROOM {code, resume}` within
`game.reconnectGraceSeconds` (60, 0 = off) to re-attach to its seat (same id, name, score; a half-open old socket is
replaced). A stale token or unknown room silently falls back to a normal join. A re-attached player sits out the
running round (receives state like a spectator) and plays again from the next game. If the host dropped and nobody
was promoted yet they are host again, otherwise the new host stays. Lobby seats are still freed immediately.
No `PROTOCOL_VERSION` bump: the field is optional.

## In-game menu and votes

Players (and spectators) get a menu button (or `Esc`) in the game view: Resume, **Restart round**, **Restart match**
and **Leave room**. A restart is a vote: the asker counts as yes and a majority of the connected players must agree
within 15 s (two players must both agree; a solo player restarts instantly). A failed vote cools down for 20 s.
Restarting the round re-runs the same minigame and keeps the scores; restarting the match zeroes them and returns to round 1.

## Roadmap

| Phase | State |
|---|---|
| 1 Lobby/networking | done |
| 2 Simulation + interpolation | done |
| 4 Match system | done (results, scoring, N rounds, final winner, rematch) |
| 5 More minigames | Ballistix (4 variants: Smashball, Sand Orb, Pulse Ball, Cloud Orbs); Frost Shove (5: Frost Classic, Frost Frenzy, Tip Tumble, Thaw Frenzy, Wild Frenzy); Spring Showdown (4: Spring Painter, Spring Rush, Spring Madness, Spring Lock); Box Bonanza (4: Jungle Bonanza, Space Bonanza, Snow Bonanza, Drain Bonanza); Crazy Logs; Sprint Smash (4: Dot Sprint, Toxic Sprint, Ember Sprint, Splash Sprint); Tank Wars (4: Desert Fox, Metal Fox, Jungle Fox, Swamp Fox); Rumble Cards (turn-based card duel, picked on the phone); more can be registered |
| 6 Hardware benchmarks | tool ready, dev-machine sweeps for every family recorded, **not run on real Pis** — see `BENCHMARKS.md` |
| 7 Party box | not started (autostart service, local DNS, Wi-Fi AP) |

Known simplifications: placeholder shapes/synth sounds, no background music yet, profiles are keyed by a private
code (no accounts or recovery if it is lost), menus are DOM overlays rather than Phaser scenes.

## Security

See [SECURITY.md](SECURITY.md). The `dev-stats` / `dev-bots` tokens in `docker-compose.yml` are for local development only: set your own `ADMIN_TOKEN` and `BOTS_TOKEN` before exposing a server.

## License

[MIT](LICENSE). Game names, characters and art are original. This project is not affiliated with or endorsed by any game publisher.
