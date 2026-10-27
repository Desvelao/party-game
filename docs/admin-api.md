# Admin API

Operator tools for a running server: live rooms, moderation, profiles, runtime settings, game
catalog, match history and health. Three ways to use the same API:

| Interface | How |
|---|---|
| Web page | `http://<host>:8080/admin` (phone friendly) |
| CLI | `npm run admin -- <command>` (see `--help`; `--` ends options, so messages may start with `-`) |
| HTTP | `/api/admin/*` with `Authorization: Bearer <token>` |

## Access

- Token: `ADMIN_TOKEN` (`server.adminToken`). The same token authorises `/stats?reset=1`.
- With no token set, only callers on the machine itself (loopback) are let in, and never a request
  that carries an `X-Forwarded-For` header (so a reverse proxy on the same host does not open it up).
- Ten wrong tokens from one address within a minute answer `429` for the rest of that minute.
- In Docker the "same machine" shortcut does not apply: published ports reach the container through the
  Docker bridge, so the server sees a non-loopback address. Always set a token when running in a container.
- Dev stack (`docker-compose.yml`): the page is at `http://localhost:5173/admin` (Vite proxies it) or
  `http://localhost:8080/admin`. The server gets `ADMIN_TOKEN` (default `dev-stats`), so `dev-stats` is the
  token unless you override it. A container created before that variable existed has no token:
  `docker compose up -d server` recreates it with the current settings.
- Behind a reverse proxy set `TRUST_PROXY=1` so bans and the rate limit see real client addresses,
  and set a token.
- Every change is written to an audit log (last 500 entries, also `dataDir/admin-audit.jsonl`).

Errors are JSON: `{"error": "..."}` (`400` bad input, `401/403` auth, `404`, `413`, `429`).

## Endpoints

### General
| Method + path | Notes |
|---|---|
| `GET /whoami` | `{ok, tokenConfigured, ip}`, handy to test a token |
| `GET /stats` | The same snapshot as `/stats`, without resetting the window |
| `GET /status` | `/stats` plus `draining` (drain mode is on), `version`, `serverTime` (ms) and `system`: host `cpuPercent` (since the previous call), `cpuCount`, `loadavg`, `memTotalMB`, `memUsedMB`, `hostUptimeSec`, `processUptimeSec`, `temperatureC` (`null` when unavailable), `node`, `platform`. Feeds the panel's Health tab; CLI: `status` |
| `GET /audit?limit=` | Newest admin actions first |

### Rooms and moderation
| Method + path | Body / notes |
|---|---|
| `GET /rooms` | Room summaries, each with `idleSeconds` and `ageSeconds`. `?idleOver=N` lists only rooms idle for N seconds or more |
| `GET /rooms/:code` | Summary plus members (`id`, `name`, `ip`, `host`, `ready`, `score`, `profileId`) |
| `GET /clients` | Every open connection with IP, room and ban state |
| `POST /rooms/:code/close` | Players get `ROOM_CLOSED` |
| `POST /rooms/:code/lock` | `{locked: true\|false}` |
| `POST /rooms/:code/broadcast` | `{message}` shown to the room as a toast (max 200 chars) |
| `POST /broadcast` | `{message}` to every room |
| `POST /rooms/:code/host` | `{id}` hands the host role to that connected player (the room is told who the host is now) |
| `POST /rooms/:code/rename` | `{id}` resets that player's name |
| `POST /rooms/:code/kick` | `{id, ban?, banIp?, reason?, minutes?}`. `ban` bans the profile (guests: the IP); `banIp` also bans the IP. No `minutes` = until lifted. Replies `{ok, banned}` where `banned` is whether a ban was actually created; `banFailed: true` is added when the ban list was full (the player is still kicked). A player with no profile or address cannot be banned (`banned: false`). |
| `GET /bans` | |
| `POST /bans` | `{ip}` or `{profileId}`, plus optional `reason`, `minutes`. Connected matches are removed at once. You cannot ban the address you are calling from. |
| `DELETE /bans?ip=` or `?profileId=` | Lift a ban |

Bans are kept in `dataDir/bans.json` (up to 1000). An IP ban hits everyone behind that address
(a shared Wi-Fi), so prefer profile bans for signed-in players.

### Maintenance and announcements
Drain mode stops new rooms (the creator gets `SERVER_DRAINING`); rooms that exist keep working and players may still join them,
so running matches finish. Announcements are sent as a toast to every open connection, menu players excluded (they have no
connection yet). A *pinned* announcement also stays as a banner for everyone, including players who connect later, until it
expires or you remove it. The latest 10 announcements can be re-read by players in the **Announcements** screen. The public
`GET /api/catalog` carries the same state as `maintenance` (`draining`, `message?`, `banners`, `recent`) for the menu.

| Method + path | Body / notes |
|---|---|
| `GET /maintenance` | `{draining, message, exitWhenEmpty, announcements, recent}`; `announcements` are the ones waiting or pinned (`id`, `message`, `at`, `until?`, `pinned`, `sent`) |
| `PUT /maintenance` | `{draining: true\|false, message?, exitWhenEmpty?}`. `message` (max 200 chars) is the banner text. With `exitWhenEmpty` the server shuts down cleanly once no room is left (it then needs to be restarted) |
| `POST /maintenance/announce` | `{message, inSeconds?, durationSeconds?, pinned?}` (max 200 chars; `inSeconds` delays it, `durationSeconds` is how long a pinned banner stays, up to 30 days; at most 20 wait at once). Replies with the announcement |
| `DELETE /maintenance/announce/:id` | Cancel a waiting announcement, or take a pinned banner down for everyone |
| `DELETE /maintenance` | Leave drain mode and drop every announcement (the history players can re-read stays; see the next two rows) |
| `DELETE /maintenance/recent/:id` | Remove one delivered announcement from the history players can re-read (404 if it is not there) |
| `DELETE /maintenance/recent` | Empty that history |

State is kept in `dataDir/maintenance.json`, so a restart keeps the banner and the schedule.

### Console mode
Only with `CONSOLE_MODE=1` (`server.consoleMode`); otherwise these answer 404. The TV (`/tv`) owns a room and shows a 6-digit
PIN; a phone that types it at `/console` gets a *console token*. That token is accepted as an admin Bearer token and lets the phone
host the TV's room without a seat.
| Method | Path | Does |
|---|---|---|
| GET | `/api/admin/console` | `{enabled, pin, paired, roomCode}` |
| POST | `/api/admin/console/pin` | new PIN (phones already paired keep working) |
| POST | `/api/admin/console/unpair` | forget every paired phone and change the PIN |

Public (no admin token): `POST /api/console/pair {pin}` returns `{token, code}` (10 wrong PINs per minute per address, then 429; 409 while no TV screen is connected);
`GET /api/console/screen` returns `{pin, code}` to the machine itself only (loopback).

### Profiles
Profile ids are SHA-256 hashes of a key the player holds; they are not secrets but are not guessable.

| Method + path | Notes |
|---|---|
| `GET /profiles?q=&sort=&limit=&offset=` | `q` matches the name (substring) or id (prefix). `sort`: `recent`, `created`, `wins`, `points`, `matches`, `name` |
| `GET /profiles/:id` | Full record |
| `PATCH /profiles/:id` | `{name?, color?, looks?, avatar?}`. `looks` maps a character model id to `{slot: option index}`; each model sent replaces that model's look (slots left out go back to the model's default), the others are kept. `avatar` is a model id, or `null` to clear it. At least one field is required; an invalid value (non-string or empty name, color outside the palette, a look or slot value the model does not have, a malformed avatar) returns 400 and nothing is changed. The audit entry records the old and new values |
| `POST /profiles/:id/reset-stats` | |
| `DELETE /profiles/:id` | A player who still holds the key can create a fresh profile; ban the id as well to stop that |
| `GET /profiles/export` | All records, same shape `POST /profiles/import` takes |
| `POST /profiles/import` | `{profiles: {id: record}}`, up to 20 000 per call; invalid entries are skipped and counted |

### Settings and catalog
| Method + path | Notes |
|---|---|
| `GET /config` | Current, configured and allowed values; which are overridden; restart-only settings |
| `PATCH /config` | `{maxRooms: 6, ...}`, all or nothing. `null` returns a field to its configured value |
| `DELETE /config` | Return everything to the configured values |
| `GET /catalog` | Games, variants and whether each is enabled |
| `GET /defaults` | Every game/variant option with allowed values and built-in default, plus the `file`, `admin` and `effective` default layers |
| `PATCH /defaults` | `{id, options: {optionId: value \| null}}` sets admin defaults for a game id (all its variants) or variant id; `null` removes one (falls back to the config file, then built-in). Persisted in `option-defaults.json` |
| `DELETE /defaults[?id=]` | Drop admin defaults of one game/variant, or all |
| `GET /playlists` | Operator playlists with `source` (`config file` / `admin`), `hidden` and whether a config file version exists |
| `PUT /playlists/:id` | `{name, rounds: [{game, variant, options}]}` adds or replaces a playlist (1-10 rounds, name up to 24 characters, at most 20 playlists). Persisted in `playlists.json` |
| `DELETE /playlists/:id` | Deletes an admin playlist, or hides a config file one |
| `POST /playlists/:id/restore` | Drops the admin change; a config file playlist is back as written |
| `PATCH /catalog` | `{disable: [ids], enable: [ids]}` or `{disabled: [ids]}`. A game id covers its variants. At least one game must stay enabled |

Live settings: `maxRooms`, `maxPlayersPerRoom` (new rooms), `maxSpectatorsPerRoom`,
`idleRoomSeconds`, `hostIdleSeconds`, `reconnectGraceSeconds`, `maxConnectionsPerIp`, `joinTimeoutMs` (milliseconds),
and the branding texts (`brandName`, `welcomeMessage`).
They are saved in `dataDir/runtime-config.json` and win over the config file after a restart; use
`DELETE /config` to drop them. Everything else (ports, tick rate, storage) needs a restart.

Disabled games cannot be picked, a new room asking for one starts with the default mix, and mixed
play skips them. Clients' menus still list them (the server answers with a message).
`GET /api/rooms` (no auth, rate limited) returns `{rooms: [{code, game, players, maxPlayers, passwordProtected}]}`: the open lobbies whose host chose to list them. Open lobbies are also saved to `rooms.json` in the data dir (settings only: never players or passwords) and restored at startup when younger than `game.roomRestoreSeconds`.

`GET /api/catalog` (no auth) returns `{disabled: [...], defaults: {...}, playlists: [...], maintenance, brand}`: the disabled ids, the effective option defaults, the operator playlists, the maintenance state and the branding.

`GET /api/leaderboard[?sort=wins|points|winrate&game=<id>&period=all|week|month&q=name]` (no auth, rate limited) returns `{sort, period, game?, total, top: [...], results?: [...]}`:
`game` is a game family id or a variant id (unknown ids are ignored) and `period` the last 7 / 30 UTC days (per-day tallies, 31 kept per profile); a filter drops players with no activity in it. `winrate` is wins / matches (rounds played of the game when `game` is set; players under 3 are listed after the rest), rows also carry `winRate` (0..1).
Served by the `leaderboard` plugin (`plugins.leaderboard.top`, default 20, 1-100; the route does not exist while the plugin is not loaded). The first `top` players ranked by wins (ties: points, matches, name), points or win rate, and with `q` up to 20 players whose
name contains it, each with their global `rank`. Rows hold `rank, name, color, looks, avatar` (when chosen), `wins, points, matches, bestMatchScore`, never
profile keys. It answers 501 when the profile store cannot be listed (`memory`).

Operator playlists come from `games.playlists` in the config file (edit them on the panel's Playlists tab); hosts load them in the playlist builder (marked with a star), which copies the rounds into their own selection, so later edits do not change rooms that already loaded one.

Option defaults come from `games.defaults` in the config file (see `config.example.yaml`, regenerate the listing with `npm run config:example`); values set through the admin API or the panel's Games tab win over the file.

### History and insight
With `server.adminInsights: false` (`ADMIN_INSIGHTS=0`) the server keeps no match history, reports or metrics samples; `/matches`, `/metrics` and `/reports` answer `404 {"error":"unavailable"}`. `/leaderboard` and `/popularity` do not depend on it.

| Method + path | Notes |
|---|---|
| `GET /matches?limit=` | Last 500 finished matches (names, scores, rounds, length); `dataDir/match-history.jsonl` |
| `GET /leaderboard?game=&sort=wins\|points&limit=` | Signed-in players only, from profile stats |
| `GET /popularity` | Rounds played per game or variant, all time, signed-in players |
| `GET /metrics` | ~10 minutes of 5 s samples: CPU, memory, load, rooms, clients, tick overruns |

## Files in `dataDir`
`bans.json`, `runtime-config.json`, `catalog.json`, `maintenance.json`, `option-defaults.json`, `playlists.json`, `match-history.jsonl`, `admin-audit.jsonl`.
They are not written when `storage.store` is `memory`.

## CLI examples
```
export ADMIN_URL=http://pi.local:8080 ADMIN_TOKEN=...
npm run admin -- rooms
npm run admin -- status                           # stats plus host CPU/RAM/load/temperature
npm run admin -- console                          # console mode: PIN, room and paired phones
npm run admin -- console new-pin | unpair
npm run admin -- notice ABCD "Pizza is here"
npm run admin -- maintenance on --exit "Back at 20:00"   # no new rooms; stop when the last one ends
npm run admin -- announce "Closing in 10 minutes" --in 600 --pin --for 1800
npm run admin -- kick ABCD 3f9a1c --ban --reason "spam" --minutes 60
npm run admin -- config set maxRooms=6
npm run admin -- config set "brandName=Bonk Night"   # text settings take text, the others whole numbers
npm run admin -- catalog disable box-bonanza
npm run admin -- defaults set jungle-bonanza timeLimit=120
npm run admin -- playlists set quick quick.json   # {"name": "Quick party", "rounds": [...]}
npm run admin -- export profiles-backup.json
```

## Prometheus metrics (optional)

Provided by the `prometheus` plugin, which is off by default (`plugins.prometheus.enabled` / `METRICS_ENABLED`; a restart
applies it). While it is off, or when the plugin is not loaded (`plugins.enabled`), `/metrics` answers 404 and none of its
code runs. When on, `GET /metrics` returns Prometheus text format and needs the
same admin token as `/api/admin/*` (`Authorization: Bearer <token>`; loopback only when no token is set).
Series: `party_game_rooms`, `_rooms_max`, `_clients`, `_ticks_total`, `_tick_overruns_total`, `_tick_step_{avg,max}_ms`,
`_tick_lag_{avg,max}_ms`, `_messages_{in,out,rejected}_total`, `_bytes_{in,out}_total`, `_frames_dropped_total`,
`_matches_finished_total`, `_recent_rounds{game}`, `_recent_round_seconds{game}` and `process_*` memory/uptime gauges.

## Audit CSV, player reports and the leaderboard shadow ban

- `GET /audit?format=csv[&limit=500]` returns the newest audit entries as CSV (`time,action,target,ip,detail`;
  cells that start with `= + - @` are prefixed with a quote so spreadsheets do not run them). The log itself is
  kept in `dataDir/admin-audit.jsonl` (last 500).
- Players can report another player in the room (`REPORT {id}`; once per pair, 3 a minute, silent to the room).
  `GET /reports[?limit&format=csv]` lists them (`ts, room, reporter, target, targetProfileId?`, newest first;
  kept in `dataDir/reports.jsonl`, last 200) and `DELETE /reports` clears them. The Rooms tab shows them with
  Ban / Hide-from-leaderboard shortcuts for signed-in players.
- `PATCH /profiles/:id {shadowBanned: true|false}` hides a profile from every public leaderboard (the player is
  not told and still plays normally). `GET /profiles` rows carry `shadowBanned`.


## Progression plugin

Served by the `progression` plugin under `/api/progression` (not `/api/admin`; the routes do not exist while the plugin is not loaded). Same admin token rules.

| Method + path | Notes |
|---|---|
| `POST /api/progression {key}` | No admin token: the caller's own progress (`key` is their profile key; rate limited). Returns `{xp, level, into, need, rounds, matches, wins, streak, bestStreak, bests, achievements}` |
| `GET /api/progression[?limit=]` | Admin. `{total, players: [{id, ...progress, achievements: <count>}]}`, highest XP first (default 100, at most 500) |
| `GET /api/progression/:profileId` | Admin. One player's progress, 404 when there is none |
| `POST /api/progression/:profileId/reset` | Admin. Forgets that player's progress |

CLI: `progression [--limit N]`, `progression-show <id>`, `progression-reset <id>`. Page: `/plugins/progression/`. Data: `<plugin data dir>/progression.json`.
