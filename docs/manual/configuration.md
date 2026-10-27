# Configuration

Every setting can come from a YAML file, from an environment variable, or from the hardware profile
(see [Performance profiles](performance-profiles.md)). Durations in the file are whole seconds.

## Where settings come from

1. **Config file**: wins over everything.
2. **Environment variable**.
3. **Hardware profile default**.

The file is found by, in order: `-c <file>` (or `--config`) on the command line, the `PARTY_GAME_CONFIG`
environment variable, then `/etc/party-game/config.yaml` if it exists. A file named by the flag or the variable
must exist. With no file the server runs from the environment alone.

```bash
node dist/server.js -c ./config.yaml        # or: npm start -- -c ./config.yaml
```

Start from `config.example.yaml` in the project root. Unknown keys and out-of-range values stop the server at
startup with one line that names the key (for example `performance.maxRoom`).

## Check a configuration without starting the server

```bash
npm run config:check -- -c ./config.yaml          # built image: node dist/config-check.js -c ./config.yaml; Linux package: party-game-config-check
```

It prints every setting with its effective value and where it came from (`file`, `env` or `default`), hides the
admin token, and exits with a non-zero code on an error. Run it before restarting a live game.

## Settings

| File key | Environment variable | Default | What it does |
|---|---|---|---|
| `server.host` | `HOST` | `0.0.0.0` | address to listen on |
| `server.port` | `PORT` | `8080` | port |
| `server.staticDir` | `STATIC_DIR` | `dist/client` | folder with the built game |
| `server.tlsCert` | `TLS_CERT` | empty | PEM certificate file; with `tlsKey`, the game is served over HTTPS ([HTTPS](https.md)) |
| `server.tlsKey` | `TLS_KEY` | empty | PEM private key file that goes with the certificate |
| `server.publicUrl` | `PUBLIC_URL` | empty | address phones should use to join (for example `http://partygame.local`); empty means the address the request came in on |
| `server.captivePortal` | `CAPTIVE_PORTAL` | `false` | party-box mode: phones that join the box's Wi-Fi are sent straight to the game; see [the party box guide](../party-box.md) |
| `server.consoleMode` | `CONSOLE_MODE` | `false` (off) | turn on to use the server as a TV console: the TV opens a room and shows a PIN, and a phone that types it becomes the host and can use the admin page; see [the party box guide](../party-box.md) |
| `server.consoleScreenAny` | `CONSOLE_SCREEN_ANY` | `false` | for testing console mode away from the TV (for example in Docker): any device may open the TV room. Leave it off on a real party box |
| `server.trustProxy` | `TRUST_PROXY` | `false` | read the client address from `X-Forwarded-For`; only behind a proxy you control |
| `server.adminInsights` | `ADMIN_INSIGHTS` | `true` | set to `false` on very small machines to stop keeping match history, player reports and the health charts; the admin page then shows them as not available |
| `server.adminToken` | `ADMIN_TOKEN` | empty | password for the admin tools |
| `performance.profile` | `PROFILE` | `NORMAL` | `LOW_POWER`, `NORMAL` or `HIGH` |
| `performance.tickRate` | `TICK_RATE` | by profile | simulation steps per second, 10-120 |
| `performance.networkRate` | `NET_RATE` | by profile | updates sent per second, 1-60 |
| `performance.maxRooms` | `MAX_ROOMS` | by profile | simultaneous rooms, 1-64 |
| `performance.maxPlayersPerRoom` | `MAX_PLAYERS` | by profile | players per room, 1-32 |
| `performance.maxSpectatorsPerRoom` | `MAX_SPECTATORS` | by profile | watchers per room, 0-64 |
| `game.idleRoomSeconds` | `IDLE_ROOM_SECONDS` | `600` | close a lobby or finished room nobody uses; `0` = never |
| `game.roomRestoreSeconds` | `ROOM_RESTORE_SECONDS` | `900` | after a restart, bring back the open lobbies saved less than this many seconds ago (players have to join again); `0` = lobbies are not kept |
| `game.idleWarnSeconds` | `IDLE_WARN_SECONDS` | `60` | warn players this long before that (never more than half of `idleRoomSeconds`); `0` = no warning |
| `game.hostIdleSeconds` | `HOST_IDLE_SECONDS` | `90` | if the host does nothing this long outside a running round while another player is active, that player becomes the host; `0` = never |
| `game.reconnectGraceSeconds` | `RECONNECT_GRACE_SECONDS` | `60` | how long a dropped player keeps their seat; `0` = off |
| `limits.joinTimeoutSeconds` | `JOIN_TIMEOUT_MS` (milliseconds) | `10` | close connections that never join; `0` = off |
| `limits.pingIntervalSeconds` | `PING_INTERVAL_MS` (milliseconds) | `30` | liveness check; `0` = off |
| `limits.maxConnectionsPerIp` | `MAX_CONNECTIONS_PER_IP` | `50` | connections per address; `0` = unlimited |
| `storage.store` | `PROFILE_STORE` | `json` | `json`, `sqlite` or `memory` |
| `storage.json.dataDir` | `DATA_DIR` | `data` | where profiles and admin data are kept |
| `storage.sqlite.path` | `SQLITE_PATH` | `data/profiles.db` | SQLite database file |
| `storage.sqlite.busyTimeoutSeconds` | `SQLITE_BUSY_TIMEOUT_MS` (milliseconds) | `5` | `sqlite` only: how long to wait when the database is locked |
| `storage.maxProfiles` | `MAX_PROFILES` | `10000` | cap on stored profiles |
| `storage.recentMatches` | `RECENT_MATCHES` | `10` | past matches each profile keeps for its **Recent matches** list (`0` keeps none, maximum `50`) |
| `gamePacks.dir` | `GAMES_DIR` | empty | folder of games you installed (empty: a `games` folder inside the data folder) |
| `gamePacks.bundledDir` | `BUNDLED_GAMES_DIR` | `dist/games` | folder of the games that come with this version |
| `plugins.dir` | `PLUGINS_DIR` | empty | folder of plugins you installed (empty: a `plugins` folder inside the data folder), see [Installing plugins](installing-plugins.md) |
| `plugins.bundledDir` | `BUNDLED_PLUGINS_DIR` | `dist/plugins` | folder of the plugins that come with this version |
| `plugins.enabled` | `PLUGINS` | `all` | which plugins to load: `all`, `none` or a list of ids |
| `plugins.bots.allowFill` | `BOTS_ALLOW_FILL` | `false` | let a room's host fill the room with bots and add bots |
| `plugins.bots.defaultLevel` | `BOTS_DEFAULT_LEVEL` | `normal` | bot level new rooms start with: `easy`, `normal`, `hard`, `expert`, `semigod` or `random` |
| `plugins.bots.mode` | `BOTS_MODE` | `embedded` | `embedded`: this server plays the bots; `external`: the separate bot server does |
| `plugins.bots.token` | `BOTS_TOKEN` | empty | secret of the bot server (its `GAME_SERVER_BOT_TOKEN`); needed only in `external` mode |
| `plugins.bots.maxBots` | `BOTS_MAX` | `0` | bots playing at once inside this server; `0` = by profile (2, 8 or 16) |
| `plugins.bots.decisionHz` | `BOTS_DECISION_HZ` | `0` | how often an embedded bot decides; `0` = by profile (10, 20 or 30). Lower is lighter on small machines |
| `plugins.bots.mixed` | `BOTS_MIXED` | `never` | `never` / `always`: bots in rooms that rotate through every game (every built-in game has a bot player; they sit out the rounds of installed games without one) |
| `plugins.bots.playlistJoin` | `BOTS_PLAYLIST_JOIN` | `any` | custom playlists: bots join when they can play `any` game of it, or only if they can play `all` |
| `plugins.bots.idleLeaveSeconds` | `BOTS_IDLE_LEAVE_SECONDS` | `120` | seconds a bot may sit out before it leaves; `0` = never |
| `plugins.bots.namePrefix` | `BOTS_NAME_PREFIX` | `Bot` | start of the bots' names (up to 8 letters) |
| `plugins.bots.api` | `BOTS_API` | `true` | management API at `/api/bots` (admin token) |
| `plugins.bots.dashboard` | `BOTS_DASHBOARD` | `true` | dashboard page at `/plugins/bots/` (needs `api`) |
| `plugins.bots.liveConfig` | `BOTS_LIVE_CONFIG` | `true` | change the settings that apply here from the dashboard |
| `plugins.bots.audit` | `BOTS_AUDIT` | `true` | log of who changed what through the management API |
| `plugins.leaderboard.top` | `LEADERBOARD_TOP` | `20` | players on the public leaderboard (the **Top** page), 1-100; to turn the leaderboard off leave `leaderboard` out of `plugins.enabled`; changing it needs a restart |
| `plugins.prometheus.enabled` | `METRICS_ENABLED` | `false` | Prometheus `/metrics` endpoint (needs the admin token); changing it needs a restart |
| `plugins.bots.metrics` | `BOTS_METRICS` | `false` | Prometheus metrics at `/api/bots/prometheus` (admin token) |
| `plugins.bots.reports` | `BOTS_REPORTS` | `false` | write a report of every bot match (files are written on the game loop: leave off on small machines) |
| `plugins.bots.reportsDir` | `BOTS_REPORTS_DIR` | empty | folder of those reports (empty: the plugin's data folder) |
| `branding.name` | `BRAND_NAME` | `Party Game` | name shown in the menu and browser tab |
| `branding.welcomeMessage` | `WELCOME_MESSAGE` | empty | text under the name; empty uses the built-in tagline |

Settings that an operator can also change while the server runs (rooms, limits, idle and grace times,
branding) are in the admin panel's **Config** tab, see [Administration](administration.md).

## Profile storage

| Store | Use it for |
|---|---|
| `json` (default) | works everywhere, one file `profiles.json` |
| `sqlite` | recommended where available: less writing to SD cards |
| `memory` | tests and throwaway servers; everything is lost on restart |

`sqlite` needs the optional `better-sqlite3` module, which has builds for amd64, arm64 and armv7. On a Pi Zero W
(arm/v6) it is not available: selecting it stops the server at startup, so stay on `json` there.

To move existing profiles from `json` to `sqlite`, stop the game, then:

```bash
npm run profiles:migrate -- --from json --to sqlite -c config.yaml
# container image:
docker compose -f docker-compose.prod.yml run --rm game node dist/migrate-profiles.js --from json --to sqlite
```

Then set `storage.store: sqlite` (or `PROFILE_STORE=sqlite`) and start again. Without the migration step a server
switched to SQLite starts with an empty database.

## Game defaults and ready-made playlists

The `games:` section sets the default of any game or variant option that hosts see when they create a room, and
can publish playlists hosts can load:

```yaml
games:
  defaults:
    jungle-bonanza: { timeLimit: 120 }
  playlists:
    - name: Quick party
      rounds:
        - game: box-bonanza
          variant: jungle-bonanza
```

`config.example.yaml` lists every option with its allowed range. Values set in the admin panel win over this file.
Hosts can still change them for their own room.
