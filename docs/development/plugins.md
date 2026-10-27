# Plugins

A plugin adds a feature to the core (see `docs/development/game-packs.md` for games). It is an installable pack with the same
container as a game pack (`.pgpack`: a deterministic gzip tar, sha256 of every file, 2 MiB limit), a different manifest
and a different contract. Plugins are trusted code: they run in the server process without a sandbox and are loaded at
start (restart to change them).

| File | Required | What it is |
|---|---|---|
| `plugin.json` | yes | manifest: `kind: "plugin"`, `id`, `name`, `version`, `apiVersion` (2), `author`, `license`, `description`, `order?`, `requires?`, `engines?`, `config?`, `capabilities?`, `rootRoutes?`, `clientRoutes?`, `locales?`, `files` |
| `server.mjs` | yes | default export: `ServerPlugin` |
| `client.mjs` | no | default export: `ClientPlugin` (the plugin's user interface) |
| `README.md` | no | |

## Workflow

```bash
npm run gamepack -- init my-plugin --kind plugin     # src/plugins/my-plugin from templates/plugin
npm run gamepack -- validate src/plugins/my-plugin   # build, verify and load it
npm run gamepack -- build src/plugins/my-plugin      # dist/packs/my-plugin-<version>.pgpack
npm run plugins -- install dist/packs/my-plugin-0.1.0.pgpack
```

`npm run build` packs everything under `src/plugins/` into `dist/plugins` (`BUILD_PLUGINS=all|none|id,id` picks which;
`--build-arg BUILD_PLUGINS=...` in Docker). The server loads the ones allowed by `plugins.enabled` / `PLUGINS`.

## Develop from source

`docker compose up` (or `npm run dev:server` + `npm run dev:client`) runs the games and plugins under `src/` straight from their source, with no build step (`DEV_SOURCE=1`, `src/core/server/plugins/sourcePacks.ts`):

- Server code: tsx loads `server/index.ts`; editing any file it imports (or the ``plugin.json``) restarts the server. Rooms are lost on a restart, profiles are not.
- Client code: Vite serves `client/index.ts` as `/plugins/<id>/client.mjs`, so a change reloads the page.
- The pack checks of `npm run build:plugins` (no core imports at runtime, size warnings) do not run in this mode, so run `npm run check` before you push. `npm run dev:server:built` starts the server the old way, from built packs.

## Manifest

- `requires`: `{ "other-plugin": ">=1.0.0 <2.0.0" }`. Plugins start after what they require; a missing or mismatching
  requirement skips the plugin. Ranges are comparators (`>=`, `>`, `<=`, `<`, `=`) joined by spaces.
- `engines.core`: the core versions it works with, same range syntax; checked against the server's version.
- `config`: typed settings (`number`, `boolean`, `string`, `choice`) with `default`, `min`/`max`, `choices`, `env` (an
  environment variable) and `secret`. Values come from `plugins.<id>:` in the configuration file (checked strictly), else the
  `env` variable, else `default`. They reach the plugin as `host.config`.
- `capabilities`: features that are not for every plugin; today only `virtualPlayers` (see "Virtual players" below). A plugin that
  does not list it never gets `host.virtualRooms` and cannot be joined from outside.
- `rootRoutes`: top-level paths the plugin answers, like `["/metrics"]`, for what has to live outside `/api/<id>/` (a scraper's
  URL). At most 8 single-segment paths; the ones the server uses (`/api`, `/plugins`, `/games`, `/admin`, `/stats`, `/status`,
  `/rooms`, `/ws`...) are refused. The plugin must implement `http`.
- `clientRoutes`: top-level pages of the app the plugin draws with its client `screen`, like `["/leaderboard"]`. The server answers them with the
  app (the client then shows the plugin's screen); at most 4, with the same rules as `rootRoutes` (and `/profile`, `/room`... are taken).
- `characters`: character models the plugin provides for the games, with their slots and options (drawn by `characters`
  of the client code). Same format and rules as in a game pack: see "Character models" in `game-packs.md`. The
  `characters` plugin (`src/plugins/characters/`) provides `blob`.
- `locales`: texts for the plugin's interface per language (`es`, `fr`, `de`, `pt`, `it`, each optional), keyed by the English sentence (`tr('English')` on the client). A missing one shows the English text.

## Server contract (`src/core/shared/plugins.ts`)

`start(host)` runs once the games are registered and the rooms exist; `stop()` runs at shutdown; `api` is offered to
plugins that require this one (`host.plugin(id)`). `host` gives: `config`, `profile` and `tickRate` (the hardware profile),
`rooms` (`list`, `get`, `on('created'|'changed'|'closed')`; `changed` is batched once per tick), `events.on(event, fn)` (the server tells the plugin as it happens: `matchFinished` with the room, time, duration and games; `resultRecorded` with the profile id and the game result or the match result (`score`, `won` and, when known, the final `place` and the number of `players`), after the store accepted it; `profileChanged` with the profile id and a `reason` of `edit`, `admin` or `result`; it returns the function that stops listening, a throwing listener is logged and ignored, and profile keys are never sent), `stats()` (rooms, clients,
game-loop timing and network counters, read when called), `matches` (`playedSinceStart()` and `recent(limit)`, the finished
matches), `games.ais()` (the AIs of installed game packs), `games.playableIds(id)` (the playable ids a game or variant id stands for),
`characters.models()` (the installed character models; a plugin's bundled copy of the core holds none),
`profiles.list()` (every stored profile, read only and without keys; `null` when the store cannot be listed; it scans the store, so cache it), `every(ms, fn)` (a timer stopped with the plugin) and `log`.

A plugin sees a room as a `PluginRoom`:

- **State per room.** `room.setExt(id, value)` keeps small JSON (4 KB at most) that goes to every player in
  `ROOM_UPDATE.ext[id]` and into the room list (`/rooms?format=json`, through `roomSummary`). Nothing is sent when it did not change.
- **Actions.** Clients send `PLUGIN_ACTION { plugin, data }` (a small plain JSON object, like `GAME_ACTION`); the server calls
  `onAction(room, clientId, data)`. Check rights yourself (`room.isHost(clientId)`).

`onAction` and `roomSummary` are for every plugin. Seats and outside joins are a capability.

### Virtual players (`capabilities: ["virtualPlayers"]`)

A plugin that lists the capability gets `host.virtualRooms` (the same rooms as `host.rooms`, typed `VirtualPlayerRoom`, with the
methods below) and may implement `virtualPlayers.authorizeJoin`. The room passed to `onAction` is the same object, so such a plugin
casts it to `VirtualPlayerRoom`. The core hands the view out by declaration; plugins are trusted code, so this is a contract and not a sandbox.

- **Seats.** `room.reserveSeat(id)` holds a seat for a virtual player about to join; `room.joinVirtual(client, { plugin, yields?,
  seat?, ext? })` seats one (lobby only; it bypasses lock and password; it is never the host; it does not count as a person, so a
  room with only virtual players closes). A virtual player with `yields` is sent away when a person needs its seat.
  `room.virtualSend(id, { t: 'READY' | 'INPUT' | 'VOTE', ... })` acts for it. `releaseSeat`, `reservedSeats`, `removeVirtual`,
  `removeVirtuals`, `setMemberExt` complete the set. A virtual player is a `PluginClient` (`send(json)`, `close()`, `id`, `name`, `looks` (by character model; the bots plugin gives each bot a random look of every model)...).
- **Outside processes.** A process that connects over the socket can ask to seat a virtual player with
  `JOIN_ROOM { code, plugin: { id, token?, data } }`; the plugin's `virtualPlayers.authorizeJoin(room, claim)` returns the `VirtualSeat` to
  use, or an error text. Without it (or without the capability) the answer is "This plugin cannot be joined from outside".

### Moving from API 1 to 2

API 2 moved the virtual player methods off `host.rooms` and the root `authorizeJoin` into the capability above. A plugin built for
API 1 still loads: it is treated as if it declared `virtualPlayers`, its root `authorizeJoin` is used, and the server logs a
reminder at start. To migrate, set `apiVersion` 2 (the `gamepack` tool does it when you rebuild), add `"capabilities": ["virtualPlayers"]`
if you seat players, use `host.virtualRooms`, and move `authorizeJoin` under `virtualPlayers`. The API 1 shim goes away in the next major.

## HTTP endpoints

A plugin may answer HTTP with `http(req)`. **Its API endpoints are registered under `/api/<plugin id>/**`; its pages under
`/plugins/<plugin id>/**`** (`client.mjs` is reserved there). Plugin ids may not shadow a core route (`admin`, `profile`,
`catalog`, `games`, `plugins`, `stats`... are rejected by the manifest check; a new core `/api/<namespace>` must be added to that list). `/plugins/index.json` and `/plugins/<id>/client.mjs` are the plugin loader's own files, like `/games/index.json`, and stay outside the `/api/<id>/` convention. A plugin whose manifest lists `rootRoutes` also gets those exact paths. `req` has `kind` (`'api'`, `'page'` or `'root'`), `method`,
`path` (after the prefix; the whole path for `'root'`), `query`, `body` (a JSON object up to 16 KB, `{}` when empty, `null` when invalid or too large) and `ip`.
Nothing is checked for you: call `req.requireAdmin()` and return what it gives when it is not null (the game server's admin
check: the admin token, or loopback only without one; wrong tokens count against the caller). Return `{ status, body, type? }`
(a string body is sent as is, anything else as JSON) or `undefined` for 404. A page that is only a shell, with no data in it,
may skip the check as the game's own `/admin` does. `host.dataDir` is a folder the plugin may write to.

## Client contract (`ClientPlugin`, `src/core/client/src/plugins/features.ts`)

`client.mjs` is fetched from `/plugins/<id>/client.mjs?v=<digest>` when the page starts (the list is `/plugins/index.json`).
The lobby asks each plugin for: `lobbyHost(ctx)` (controls in the host's **Room controls**), `lobbyInfo(ctx)` (a line for
everyone), `lobbyRow(player, ctx)` (a tag and host buttons on a player's row) and `lobbyRows(ctx)` (extra rows). `ctx` offers
`t`, `tr`, `h` (a tiny DOM builder), `state()` (the room state set with `setExt`), `playerState(id)`, `players()`, `myId()`,
`isHost()`, `phase()`, `maxPlayers()` and `send(data)` (a `PLUGIN_ACTION` to the plugin). Design for phones first and avoid
hover-only controls.

`screen` gives the plugin a page of its own: `{ path, navLabel, render(ctx) }`. The app adds a button `navLabel` to the top navigation
(before Profile), shows the plugin's `render` result (a `<div class="panel">`) when the button or `path` is opened (list `path` in the manifest's
`clientRoutes`), and keeps the page working inside a room. Its `ctx` adds `avatar({ looks, avatar }, color, size)` (the player's avatar model with their look of it, on a canvas),
`games()` (the catalog's game families), `presence()` (the "players online" pill) and `back()` (to the main menu).

`characters` (`{ <model id>: (look, color, r, facing) => Shape[] }`) draws the character models the manifest declares.

Two more slots serve the profile. `profileSection(ctx)` draws a block at the end of the profile's **Info** tab; its `ctx` adds
`profileKey` (the player's secret code), `games()` (the catalog's game families), `copy(text, done)`, `toast(text)` and `qr(text, px?)` (an `<svg>` QR code). `recoveryInput`
(`{ hash, resolve(raw) }`) is another way to adopt a profile on a device: `hash` is the link fragment it handles (`#<hash>=...`)
and `resolve` turns what was pasted or opened into a profile key, or `null`. The core keeps the plain profile code and the
`#recover=` link; the transfer plugin adds one-time codes with these two slots.

## Limits of the plugin API

Trusted JavaScript only; restart to install, remove or upgrade; the interface is limited to the lobby, profile and screen slots
above; a plugin has no admin tabs of its own (it can serve its own page under `/plugins/<id>/`). A
plugin may import only types and `core/shared/kit` helpers from the core, so a small constant such as the profile-key pattern is
copied into the plugin. For per-address rate limiting import `FixedWindowLimiter` from `core/shared/kit/ratelimit` (bounded memory:
when full it drops expired windows, then the oldest, so a flood cannot lock other addresses out); the leaderboard, progression and
transfer plugins use it.

## The prometheus, transfer, leaderboard and progression plugins

`src/plugins/prometheus/` serves `GET /metrics` through `rootRoutes`, reading `host.stats()` and `host.matches`, behind
`req.requireAdmin()`; its `enabled` setting (`METRICS_ENABLED`) is off by default. `src/plugins/transfer/` keeps the one-time
transfer codes at `/api/transfer` and draws its block in the profile with `profileSection` and `recoveryInput`. `src/plugins/leaderboard/` ranks `host.profiles.list()` at `GET /api/leaderboard` (its own 5 s cache and rate limit) and draws the **Top**
page with `screen`. `src/plugins/progression/` listens to `host.events.on('resultRecorded')`, keeps XP, levels, streaks, best places and achievements in `dataDir/progression.json` (the core's `ProfileStats` are untouched), answers the player at `POST /api/progression {key}` and draws its block with `profileSection`. All four are examples of an optional feature that used to be part of the core.

## The bots plugin

`src/plugins/bots/` is the first plugin: `server/` (room state, host actions, seat authorization), `client/` (the lobby
controls), `engine/` (router, bot manager, room watcher and the in-process runner, shared with the bot server in `bot/`). A
game's AI is the `ai` export of its pack (`src/games/<id>/bot/`, see `game-packs.md`); other plugins can add AIs through the
shared registry. In `embedded` mode the bots are virtual players driven by one shared timer; in `external` mode the plugin
only keeps the state and authorizes the bot server (see `bot/README.md`).
