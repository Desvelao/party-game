# Party-game AI player (external bot)

A standalone Node + `ws` process that joins a running party-game server over the normal WebSocket protocol, exactly like a phone, and plays. It writes per-match reports so the AI can be analysed and improved afterwards (by a person or Claude Code).

```
bot/
  index.ts          CLI                         analyze.ts   report aggregator -> summary.md (formatting in summary.ts)
  core/             SHARED, knows no game       client.ts (ws, lobby, reconnect) · game-bot.ts (contract) ·
                                                registry.ts · track.ts (velocity from snapshots) · recorder.ts (reports)
  games/<id>/       ONE FOLDER PER GAME         re-exports the AI of src/games/<id>/bot (the pack owns it)
  games/index.ts    one registerGame() line per game
```

## Run

Needs Node >= 18 (Node 22 recommended). Start a server first (for example `docker compose up`; for a throwaway test server: `PORT=18080 PROFILE_STORE=memory npx tsx src/core/server/main.ts`).

```bash
# bot creates and hosts a room, starts when a second player is ready
npm run bot -- --url ws://localhost:8080/ws --create --game ballistix --variant smashball --opt lives=3 --min-players 2
# bot joins your room (code shown on the host screen)
npm run bot -- --code ABCD
# compare policies / parameters
npm run bot -- --code ABCD --policy greedy
npm run bot -- --code ABCD --param aim=0.8 --param noise=15 --matches 3
npm run bot:analyze            # writes bot/reports/summary.md
```

To run it on another machine, install the release package (`party-game-bot` deb, rpm or tarball, or the `-bot` container image; see `docs/manual/deployment.md`), or copy the repo (or `bot/` plus the type and geometry files it imports from `src/`); it never imports server code.

## Reports

`bot/reports/<time>-<room>/` (git-ignored):

| file | content |
|---|---|
| `match.json` | server config (tick/net rate), policy + all parameters, per round: placement, points, incident causes, metrics (hits, smashes, goals conceded, tracker quality), latency (RTT, snapshot gaps) |
| `events.jsonl` | every game event, the bot's decision trace (~10 Hz: paddle, target, chosen ball, predicted impact/slack) and round boundaries |
| `incidents/NNN-<cause>.json` | one per life lost: classified cause, evidence, the bot's last ~1.5 s of decisions (every 33 ms) and the last 40 raw snapshots + inputs |

`npm run bot:analyze` merges all reports: results by game/policy/parameters/variant (Ballistix has an extra-columns table), a histogram of why lives were lost, and the incident files to read first.

### Improving the AI with Claude Code

The project skill `/bot-tune` (`.claude/skills/bot-tune/SKILL.md`) automates this: it reads `bot/reports/summary.md`, explains the game, judges whether each level is calibrated, proposes at most 3 parameter changes per iteration, and logs the before/after in `bot/reports/tuning-log.md`.

1. Play a few matches (`--matches 5`, humans or another bot as opponent).
2. `npm run bot:analyze`, then ask Claude Code to read `bot/reports/summary.md` and 3-5 incident files of the most common cause.
3. Claude edits `src/games/ballistix/bot/policy/predictive.ts`, `physics.ts` or `params.ts`; re-run and compare the tables (same variant and options).

Known limits to start from: balls bouncing off other players' paddles are not predicted (`never-predicted`), and ball-ball collisions are not modelled. Drag, the magnet (Sand Orb), engine pull (Cloud Orbs) and the opponents' repulsion (Pulse Ball) are handled by the variant adapters (see "Variants" below). `never-predicted` is meaningless for the `greedy` policy, which makes no predictions.

## Games with an AI

Every built-in game pack ships its AI in `src/games/<id>/bot/` (the pack's `ai` export). Each pack's `AGENTS.md` describes how it plays, its levels and parameters, its incident causes and the knobs that fix them, and what to check when the game's rules change.

| game | policy | ladder scenarios (`bot/scenarios/`) |
|---|---|---|
| Ballistix | `predictive`: projects balls to its paddle plane | `ladder.json`, `ladder-<variant>.json` |
| Frost Shove | `sumo`: simulates stick directions, dashes into rivals with their back to the edge | `ladder-<variant>.json` |
| Crazy Logs | `hopper`: picks the landing spot that cancels a log's spin, aims the hop with the stick | `ladder-crazy-logs.json` |
| Spring Showdown | `planner`: searches hop paths (paint, steal, bank, items, missile lanes) | `ladder-<variant>.json` |
| Rumble Cards | `planner`: picks the play of the turn, works the cross and buttons to make it | `ladder-rumble-cards.json` |
| Tank Wars | `tactician`: simulates moves (shots, blasts, path), turns to fire with lead | `ladder-<variant>.json` |
| Box Bonanza | `brawler`: dodges crates and blasts, picks up, throws with lead, kicks | `ladder-<variant>.json` |
| Sprint Smash | `racer`: tries racing lines around the ring, fires items when they will hit | `ladder-<variant>.json` |

Every AI also has a `greedy` policy (a simple baseline for A/B runs) and the same five levels. The variant ladders are named after the variant (`ladder-desert-fox.json`...). For a fast check without a server, add `--offline` (it shuffles the seat order every round, since a seat is a spawn point and, in Tank Wars, a cannon): `npm run bot:arena -- bot/scenarios/ladder-frost-classic.json --offline --matches 3`. Each pack's `bot/sim.ts` (`playRound(variant, seats, opts)`) plays headless rounds for tests and A/B comparisons.

## Difficulty levels

The table below is Ballistix's; the other games' levels are in their `levels.ts` and `AGENTS.md`.

`--level NAME` picks a preset of skill parameters (`src/games/ballistix/bot/levels.ts`; no level = full strength with the defaults in `params.ts`). A level is built from human-like handicaps, so it can be tuned by changing numbers:

| level | reaction | paddle speed | aim error | lapses/s | reads bounces | boost |
|---|---|---|---|---|---|---|
| easy | 380 ms | 60% | 45 px | 0.3 | 1 | never |
| normal | 220 ms | 80% | 22 px | 0.1 | 2 | saves, close range |
| hard | 110 ms | 95% | 10 px | 0.03 | 3 | yes |
| expert | 50 ms | 100% | 3 px | 0 | 5 | yes, aims returns |
| semigod | 0 ms | 100% | 0 | 0 | all | yes, aims returns at the weakest side |

These are first guesses: run `bot/scenarios/ladder.json`, read the "Level vs level" table and "Ladder check" in `summary.md`, and change the presets until each level beats the one below it clearly (target 65% of rounds). `--param k=v` overrides any value of a level.

## Scenarios (`npm run bot:arena`)

One command starts a whole room: the first bot seat creates it and hosts, the other bots join, a `human` seat makes the runner print the room code and wait for you (the match starts when everyone is ready).

Run these from the repo root with Node 22. The default server is `ws://localhost:8080/ws` (add `--url` for another host). Bot-only rooms need no browser; for `human` seats join the printed room code in the browser.

```bash
# 1. Bot vs you
npm run bot:arena -- bot/scenarios/bot-vs-human-easy.json
npm run bot:arena -- bot/scenarios/bot-vs-human-normal.json
npm run bot:arena -- bot/scenarios/bot-vs-human-hard.json
npm run bot:arena -- bot/scenarios/bot-vs-human-expert.json
npm run bot:arena -- bot/scenarios/bot-vs-human-semigod.json

# 2. Three bots (easy, normal, hard) vs you
npm run bot:arena -- bot/scenarios/bots-vs-human.json

# 3. Ad hoc, no file: any mix of levels, "human" for you
npm run bot:arena -- --seats hard,normal,human --matches 2

# 4. Bots vs bots, no human
npm run bot:arena -- bot/scenarios/ladder.json --rooms 3 --matches 5   # level ladder
npm run bot:arena -- bot/scenarios/duel-normal-hard.json                # 1v1 between two levels
npm run bot:arena -- bot/scenarios/config-compare.json                  # A/B of aim 0.1 vs 0.9
npm run bot:arena -- bot/scenarios/stress.json --rooms 2                # 2 lives, 4 balls, many incidents

# 5. Analyze what was collected (reads arena runs too), then give bot/reports/summary.md to Claude Code
npm run bot:analyze
npm run bot:analyze -- --reports bot/reports
```

The first examples of this section, in one place:

```bash
npm run bot:arena -- bot/scenarios/bot-vs-human-normal.json          # 1 bot vs you
npm run bot:arena -- --seats hard,normal,human --matches 2           # ad hoc, no file
npm run bot:arena -- bot/scenarios/ladder.json --rooms 3 --matches 5 # bot-only rooms in parallel
npm run bot:analyze -- --reports bot/reports                         # reads arena runs too
```

Tips: `--matches 0` keeps the bots in the room until Ctrl-C; `--opt timeLimit=60 --opt lives=2` shortens matches; to run a single seat by hand use `npm run bot -- --code ABCD --level hard`.

Options: `--url`, `--variant`, `--opt k=v`, `--matches N` (0 = until stopped), `--rooms N` (identical rooms in parallel; the NORMAL profile allows 4), `--reports DIR`.

Scenario file (`bot/scenarios/*.json`): `{ name, description, url?, game?, variant?, options?, seats: [{bot: level, name?, params?} | {human: true}], matches?, rooms?, startDelayMs? }`. Shipped recipes:

| file | what it runs |
|---|---|
| `bot-vs-human-<level>.json` (5 files) | one bot of that level vs you |
| `bots-vs-human.json` | easy + normal + hard vs you, 4 seats |
| `ladder.json` | easy, normal, hard, semigod in one room (2 rooms, 3 matches) - calibrates the levels |
| `ladder-<variant>.json` (`sand-orb`, `pulse-ball`, `cloud-orbs`) | the same ladder in another variant |
| `duel-normal-hard.json` | 1v1 between two levels (copy it for another pair) |
| `config-compare.json` | same level, two parameter sets (A/B of one tweak) |
| `stress.json` | 4 bots, 2 lives, 4 balls - many lives lost, lots of incidents to analyse |

Each run writes `bot/reports/<scenario>-<time>/` with one report folder per bot plus `arena.json`. Bot-only rooms need no browser and no human; they play in real time (a 3-round match takes about 2 minutes; add `--opt timeLimit=60 --opt lives=2` to shorten it).

### Offline (faster than real time)

`--offline` plays the same scenario without a server: the bots play the headless game simulation in-process, and a ladder match takes well under a second. Each round starts with the room's 3 s countdown, as on a server, and `--rooms N` plays the rooms one after another (the simulation uses one CPU thread; run several `bot:arena` commands to use more cores). The reports have the same format, so `npm run bot:analyze` reads them unchanged, and many rooms are cheap:

```bash
npm run bot:arena -- bot/scenarios/ladder.json --offline --rooms 50
npm run bot:arena -- bot/scenarios/config-compare.json --offline --rooms 40 --seed 7 --profile LOW_POWER
```

Each bot is the same `BotBrain` the live client runs. It gets snapshots every `round(tickRate / networkRate)` ticks, JSON round-tripped like on the wire (positions only, so velocities still come from the tracker), and it decides every 33 ms on a simulated clock. Flags: `--profile LOW_POWER|NORMAL|HIGH` (the server's tick/network rates, default NORMAL) or `--tick HZ --net HZ`, `--seed N` (default 1; the same seed replays the same rounds), `--verbose` (the bots' logs). Limits: bot seats only, and no network latency or jitter, so confirm a tuning with a live run before trusting it against people.

## Companion server (bots that join open rooms by themselves)

A separate process that watches a party-game server and puts a bot in the lobbies where one fits, with a dashboard. Start it next to (or away from) the game server:

```bash
npm run bot:server -- --server http://localhost:8080                 # dashboard on http://127.0.0.1:8090
npm run bot:server -- --server http://game:8080 --level hard --max-bots 6 --admin-token "$ADMIN_TOKEN"
ADMIN_TOKEN=secret npm run bot:server -- -c bot/server/config.example.yaml   # settings from a YAML file
npm run build:bot && node dist/bot-main.js --server http://game:8080  # built (needs dist/bot-worker.js beside it)
```

How it decides (`bot/server/watcher.ts`): every 3 s it reads the server's `/rooms?format=json`. A bot joins a room that is an **open lobby** (not locked, no password, a free seat), has at least one **human** (`--min-humans`), and plays a game the **AI router** has an AI for. Rooms with a game it has no AI for (and, by default, the mixed rotation) are left alone. A **custom playlist** is joined when the AI knows *any* of its games (`ai.playlistJoin: any`, the default) or only when it knows *all* of them (`all`). In a round of a game it does not know, the bot sits it out (state **idle**, no input) and **leaves after `ai.idleLeaveSeconds`** (default 120; `0` = stays idle for good); the same timer runs if the host switches a lobby to a game without an AI. A bot that left because it was idle does not come back to that room until the room's game changes. Once in, the bot marks itself ready, never starts the match or hosts (if the host role falls to it, it leaves), votes yes to "play again", and leaves when the last human does or the room closes. A room where a bot failed is left alone for `cooldownSeconds`.

### Configuration (same model as the game server)

Settings come from a YAML file, environment variables or defaults, **file > environment > default**, exactly like the game server. The only command-line options are `-c/--config <file>`, `--check` and `-h`; everything else is an environment variable. For convenience the examples above also use a few extra flags (`--server`, `--level`, `--max-bots`, `--port`, ...); they are not in the game server and beat both the file and the environment (`--help` lists them).

- **File lookup**: `--config`, then `$BOT_SERVER_CONFIG`, then `/etc/party-game/bot-server.yaml` if it exists. A named file must exist; unknown keys and out-of-range values stop the start with a one-line error. `bot/server/config.example.yaml` documents every setting (regenerate with `npm run bot:config:example`).
- **Check**: `npm run bot:server -- --check` prints every effective value and where it came from (flag, file, env, default; secrets masked) and exits non-zero on errors.
- **Admin token**: `ADMIN_TOKEN` (`server.adminToken`, the old `BOT_TOKEN` still works with a warning). It protects the dashboard, `/api/*` and `/metrics`. Without one, only the machine itself is let in (never through a proxy header), and a non-loopback `BOT_HOST` is refused. Ten wrong tokens from one address within a minute answer `429`. In Docker the "same machine" shortcut does not apply, so always set it there (the compose files do: `ADMIN_TOKEN` in the dev stack, `BOT_ADMIN_TOKEN` in production; see "Docker" below). `GAME_SERVER_ADMIN_TOKEN` is the token of the game server being served (default: the same `ADMIN_TOKEN`) and adds its machine CPU/RAM to the dashboard.

| setting (YAML) | env | default | live |
|---|---|---|---|
| `gameServer.url` | `GAME_SERVER_URL` | `http://localhost:8080` | restart |
| `gameServer.adminToken` | `GAME_SERVER_ADMIN_TOKEN` | `ADMIN_TOKEN` | restart |
| `server.host`, `server.port` | `BOT_HOST`, `BOT_PORT` | `127.0.0.1`, `8090` | restart |
| `server.adminToken` | `ADMIN_TOKEN` (alias `BOT_TOKEN`) | none (local only) | restart |
| `server.dataDir` | `BOT_DATA_DIR` | `bot/data` | restart |
| `join.pollSeconds`, `botsPerRoom`, `maxBots`, `minHumans`, `cooldownSeconds`, `recheckSeconds` | `BOT_POLL_SECONDS`, `BOT_BOTS_PER_ROOM`, `BOT_MAX_BOTS`, `BOT_MIN_HUMANS`, `BOT_COOLDOWN_SECONDS`, `BOT_RECHECK_SECONDS` | 3, 1, 8, 1, 30, 60 | live |
| `ai.level`, `ai.mixed`, `ai.playlistJoin`, `ai.idleLeaveSeconds`, `ai.namePrefix` | `BOT_LEVEL`, `BOT_MIXED`, `BOT_PLAYLIST_JOIN`, `BOT_IDLE_LEAVE_SECONDS`, `BOT_NAME_PREFIX` | `normal`, `never`, `any`, `120`, `Bot` | live |
| `ai.levels`, `ai.policies`, `ai.params` (per game id / per parameter) | file only | empty | live |
| `reports.enabled`, `reports.dir` | `BOT_REPORTS`, `BOT_REPORTS_DIR` | `true`, `bot/reports/companion` | live, restart |
| `metrics.enabled` | `BOT_METRICS` | `true` | live |

**Admin panel**: the dashboard's **Config** tab (login with `ADMIN_TOKEN`) edits every *live* setting while the companion runs: **Apply** sends only what changed (all or nothing, validated with the same ranges as the file), **Reset all to configured** drops the panel's changes, and the "Needs a restart" table lists the rest (secrets shown as set/unset). Changes apply at once (a new poll interval, bot limit, level, `/metrics` on/off, ...), win over the file until reset, and are kept in `dataDir/runtime-config.json` across restarts. Lowering **max bots** stops no bot; it only blocks new ones. The **Audit** tab (and `dataDir/audit.jsonl`) lists who changed a setting, paused joining or stopped a bot. API: `GET/PATCH/DELETE /api/config`, `GET /api/audit`, `GET /api/whoami`.

Layers (so the AI can later also run inside the main server or a game pack):

| layer | where | job |
|---|---|---|
| game AI | `bot/games/<id>` | perception, decisions, levels, incident reports of one game |
| AI router | `bot/router/router.ts` | pure logic: "is there an AI for this room's game, which level/policy?" (no sockets, no threads) |
| runner | `bot/server/runner.ts` | how a bot runs; today one worker thread per bot (own heap and event loop, so per-bot numbers are real). An in-process runner inside the main server would implement the same `BotRunner` interface |
| companion server | `bot/server/*` | room watcher, bot table, metrics, dashboard/API |

Reports: with reports on (default; `--no-reports` or `reports.enabled: false` to stop them) each companion bot writes the same report as `npm run bot` into `bot/reports/companion/` (scenario `companion`), so `npm run bot:analyze -- --reports bot/reports/companion` and `/bot-tune` work on real games with humans.

Dashboard (`http://127.0.0.1:8090/`, same look as the game server's /admin; any non-loopback host needs `ADMIN_TOKEN`, sent as `Authorization: Bearer`):
- **Bots**: one row per bot with level, game/variant, room, state (joining, in lobby, playing, results, left), current round, last place and points, CPU, RAM, uptime and a Stop button; **Pause and remove bots** stops all joining.
- **Resources**: tiles and charts for this machine, the party-game server, this companion process, the AI bots as a group and each bot (CPU and RAM bars), plus 10 minutes of history. Bot CPU is the busy share of the bot's own thread (100% = one core); bot RAM is its V8 heap plus buffers; "Without the bots" is the companion's manager and dashboard. The game server's CPU/RAM come from its public `/stats` (average since its last reset); pass its `ADMIN_TOKEN` (`--admin-token`) for the live value and its machine's CPU/RAM/temperature.
- **Rooms**: every room of the game server with the decision taken (bot present, waiting for a human, match running, locked, full, no AI for this game, ...). Each row has **Add bot** (with a level choice) and **Remove bots**. A manual add skips the wait for humans and the cooldown but still needs: an open lobby (no password, not locked, a free seat), joining not paused, fewer than `join.maxBots` bots, and an AI for the room's game (a playlist follows `ai.playlistJoin`); otherwise the reason is shown. API: `POST /api/rooms/:code/bot` (`{level?}`), `POST /api/rooms/:code/bots/remove`.
- **Log**: what the bots report.

### Prometheus metrics

`GET /metrics` (text format 0.0.4, same auth as the API: `Authorization: Bearer <ADMIN_TOKEN>`, or local access only without a token). On by default because it only reads state at scrape time; `--no-metrics`, `metrics.enabled: false` or `BOT_METRICS=0` removes the route. (The game server's own exporter, `metrics.enabled` in its config, is off by default; this one is read-only and shares the dashboard's auth.)

| group | metrics |
|---|---|
| companion | `party_game_bots_info`, `_uptime_seconds`, `_paused`, `_max`, `_game_server_up`, `_last_poll_timestamp_seconds`, `_ai_games{game}`, `_running{game,level}`, `_rooms{decision}` |
| lifetime counters | `party_game_bots_started_total{game,level}`, `_ended_total{reason}`, `_rounds_total`, `_matches_total`, `_points_total`, `_results_total{game,level,place}`, `_incidents_total{game,level,cause}` |
| each running bot | `party_game_bot_cpu_percent`, `_memory_bytes`, `_uptime_seconds`, `_rounds`, `_points`, `_last_place`, `_state{state}`; labels `bot`, `name`, `game`, `level`, `room` |
| bots as a group | `party_game_bots_count`, `_cpu_percent`, `_memory_bytes` |
| companion process | `process_cpu_seconds_total`, `process_resident_memory_bytes`, `process_heap_used_bytes`, `party_game_bots_core_cpu_percent` (without the bots) |
| this machine | `party_game_bots_host_cpu_percent`, `_host_memory_used_bytes`, `_host_memory_total_bytes`, `_host_load1`, `_host_cores` |
| game server | `party_game_server_up`, `_cpu_percent`, `_cpu_instant`, `_rss_bytes`, `_heap_bytes`, `_rooms`, `_rooms_max`, `_clients`; with `--admin-token` also `_host_cpu_percent`, `_host_memory_used_bytes`, `_host_memory_total_bytes`, `_host_temperature_celsius` |

Per-bot series exist only while the bot runs (at most `maxBots`), so cardinality stays small; values are at most 3 s old (the dashboard's sampling interval). Bot CPU is the busy share of the bot's thread (100 = one core); `_cpu_instant` is 0 when the game server's CPU is only the average since its last stats reset (no admin token).

```yaml
# prometheus.yml
scrape_configs:
  - job_name: party-game-bots
    scrape_interval: 5s
    authorization: { credentials: "<ADMIN_TOKEN>" }   # omit when the companion has no token and Prometheus runs on the same machine
    static_configs: [{ targets: ["bots-host:8090"] }]
```

Handy queries: `sum by (game, level) (party_game_bots_running)`; `topk(5, party_game_bot_cpu_percent)`; round win rate per level `sum by (level) (party_game_bots_results_total{place="1"}) / sum by (level) (party_game_bots_rounds_total)`; lives lost by cause `sum by (cause) (rate(party_game_bots_incidents_total[1h]))`; bots RAM vs game server RAM `party_game_bots_memory_bytes` and `party_game_server_rss_bytes`.

API: `GET /api/state`, `GET /api/metrics`, `POST /api/bots/:id/stop`, `POST /api/pause?paused=1|0`, `GET /healthz` (no auth).

### What this server shares with the bots plugin

The management features are one code base (`src/plugins/bots/engine/ops`): the decision view per room, the dashboard page, the JSON API (state, bots, rooms, pause, config, audit, metrics), the live config panel, the audit log, Prometheus metrics and the match reports. The game server's bots plugin serves the same page and API at `/plugins/bots/` and `/api/bots/**` (admin token of the game server), with a switch for each part (`BOTS_API`, `BOTS_DASHBOARD`, `BOTS_LIVE_CONFIG`, `BOTS_AUDIT`, `BOTS_METRICS`, `BOTS_REPORTS`). What only makes sense in a server of its own stays here: its listener, host/port and token, `/healthz`, the game server URL and tokens, polling, the lobby join rules for rooms nobody asked bots for (`join.botsPerRoom`, `join.minHumans`), a worker thread per bot with CPU/heap per bot, the probe over a spectator socket, and the YAML/env/CLI configuration. Inside a game server the live config lists only the settings that apply there.

### Bots chosen by the host (fill the room)

Hosts fill their room with bots, set their level and add single bots with the **bots plugin** of the game server (`src/plugins/bots`, see `docs/development/plugins.md`). The plugin keeps the settings in each room and lists them in `/rooms?format=json` (`ext.bots`: `fill`, `level`, `seats`, `mode`). The plugin has two modes (`BOTS_MODE`):

- `embedded` (default): the game server plays the bots itself, as virtual players, with the same engine this server uses. This server leaves such rooms alone.
- `external`: this server plays them. Set `GAME_SERVER_BOT_TOKEN` (`gameServer.botToken`, `--bot-token`) to the game server's `BOTS_TOKEN`: bots present it in `JOIN_ROOM {plugin: {id: 'bots', token, data}}`, and the plugin seats them (they join locked rooms, are never the host and do not keep a room open). This server then joins one bot per reserved seat and enough fill bots for the free seats, at the room's level, and sends them away when the settings change.

On a game server without the plugin, the automatic join of waiting humans (`join.*`) works as before. The engine (router, manager, watcher, brain) lives in `src/plugins/bots/engine` and is built into this server; `BOT_GAMES_DIR` (folders of installed game packs, `:`-separated) adds the AI of packs this build does not know.

### Docker

- **Dev:** `docker compose up` starts the `bot` service next to `server` (it runs `npm run bot:server` from the bind mount). Dashboard at `http://localhost:8090`, token `ADMIN_TOKEN` (default `dev-stats`). Reports and the audit log land in `bot/reports/companion` and `bot/data`. Set `BOT_LEVEL`, `BOT_MAX_BOTS`, ... in the environment to change the settings above.
- **Production:** `docker/Dockerfile.bot` builds the two bundles (`npm run build:bot`) into a small image; `docker-compose.prod.yml` has it as the `bot` service under the `bot` profile: `BOT_ADMIN_TOKEN=<token> docker compose -f docker-compose.prod.yml --profile bot up -d`. Data (audit log, reports) is kept in the `party-game-bot-data` volume; a config file can be mounted at `/etc/party-game/bot-server.yaml`.
- If the game server serves HTTPS, set `GAME_SERVER_URL=https://...`; for a self-signed certificate also set `BOT_TLS_INSECURE=0` (passed on as `NODE_TLS_REJECT_UNAUTHORIZED`).

## Getting useful reports

A match the bot wins without losing a life produces no incidents. For improvement data, make it lose some: `--opt lives=2 --opt balls=4`, 3-4 seats (use `bot:arena` scenarios, e.g. `stress.json`), other variants (`cloud-orbs`, `pulse-ball`), and `--matches 0` to keep it in the room for rematches. In `summary.md`, "smash share of scoring" is the share of opponent goals that came within 4 s of the bot's boost.

## Ballistix notes (what the bot assumes)

- Snapshots carry no velocities (15-30 per second): velocities are estimated by matching ball ids. If a wall/corner simulation reproduces the observed position, the simulated velocity is used, so bounces between two snapshots do not corrupt it.
- It works in its own frame (own goal at the bottom), projects each ball to the paddle plane, takes the soonest reachable one, angles the return (offset x 62 degrees) at the opponent with the fewest lives, and boosts (`a1`; `a2` in Sand Orb, where `a1` is the magnet) to save an unreachable ball or when a ball is close.
- Input is sent at ~30 Hz on change plus every 250 ms (the server limit is 90 messages/s).

## Variants (Ballistix)

One AI plays all four variants; smash ball is the baseline. What a variant changes lives in `src/games/ballistix/bot/variants/` (`types.ts` explains the two hooks: `Physics` and `refine`). The decision to extend one AI instead of writing one per variant is recorded in `AGENTS.md` (rule 6).

| variant | what the bot adds |
|---|---|
| smash ball | nothing (the baseline) |
| sand orb | drag and the speed floor in the projection; the magnet: pulls when a ball comes inside its reach, then steers the paddle at the speed that sends the launch at the weakest opponent and lets go (`magnet`, `magnetHold`); boost on `a2` |
| pulse-ball | the ball-bot as an obstacle; the push of the opponents' repulsion (not its own: it would chase its own prediction). Fetching the repel item was measured (about 400 simulated rounds) and does not pay, so it is not played |
| cloud-orbs | engine pull (ramped, from the warning phase on) |

Level gating: `magnet` is the share of incoming balls a level goes for with the magnet (easy 0.3, normal 0.6, hard 0.85, expert and semigod 1); `variantAware: 0` turns all of this off (every variant is played as smash ball), which is how the changes were measured.

### Measuring without a server

`src/games/ballistix/bot/sim.ts` (`playRound(variant, seats, opts)`) plays a whole round in-process, no sockets, with bots in every seat; it returns places, lives, goals conceded, incident causes and event counts. An A/B is two seats with different `params` (`{ variantAware: 1 }` vs `{ variantAware: 0 }`), swapping seats between rounds and using at least 150 rounds: with 2 identical bots a 60-round split of 27-33 is normal noise. It runs with Node 22 (`export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH`) through `tsx`. Results at the time of writing (hard level, aware vs crash-ball view): sand orb 22-9, cloud orbs with frequent engine failures (`failEvery=5`) 130-70, cloud orbs and pulse-ball with default options even. The live ladder (`ladder-<variant>.json`) is still the reference for calibrating levels per variant.

## Adding a game or variant

1. Follow an existing pack (Frost Shove is the smallest real-time one, Rumble Cards the turn-based one) and its `AGENTS.md`. Create `src/games/<id>/bot/index.ts` exporting a `GameAi` (also the pack's `ai` export, so the bots plugin and the bot server load it from the pack) (`kind` = the `GAME_STATE.state.kind`, e.g. `ext:ballistix`) whose `create()` returns a `GameBot` (`bot/core/game-bot.ts`): read snapshots, `decide()` an `InputState`, report `metrics()` and classify incidents.
2. For the bot tools, add one `registerGame(...)` line in `bot/games/index.ts` (the game server's bots plugin needs nothing: it takes the pack's `ai`).
3. Variant-specific behaviour stays in that game's folder (read `state.variant`); `bot/core` is untouched. For a new variant of an existing game add an adapter (see "Variants") and a `ladder-<variant>.json`, do not fork the bot.
4. Write the pack's `AGENTS.md` (the game, its integration with the core, the bot, and the "When the game rules change" checklist), and a "rules contract" test that fails when the rules the bot relies on change.

## Running the bot inside the party-game server (research)

There is no seat-injection hook: a room member wraps a `Client` around a real socket. Options, cheapest first:

1. **Loopback (recommended)**: start this same `BotClient` from the server process against `ws://127.0.0.1:<port>/ws`. Same protocol and same estimated-velocity input, so reports stay comparable; it counts against the per-IP connection and rate limits.
2. **Fake `Client` in core**: stub a `Client` whose `send` is a no-op, `room.join()` it and call `room.handleInput()` from `RoomManager.update`. The bot could read the exact minigame state (with velocities), but this changes core and diverges from the external bot. Only worth it as the "bot fillers for empty seats" feature (`tasks.csv`, row 1).
