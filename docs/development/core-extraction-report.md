# Core audit: what is optional, what can be a plugin

Task 40 of the backlog. The goal: a minimal server that is light on a Raspberry Pi Zero W, where operators add only the features they want
as plugins (`docs/development/plugins.md`). This report separates what the server needs from what it merely has, and says what to extract
and how hard it is. Three extractions have been done (Prometheus, profile transfer and the leaderboard); the rest are follow-up tasks.

## What a minimal server needs

Rooms (`rooms/`), the game loop (`game/GameLoop.ts`), networking (`networking/`), the game pack loader (`plugins/loader.ts`, `pack.ts`,
`install.ts`), configuration (`config.ts`, `configFile.ts`), and profiles behind one driver (`profiles/ProfileRepository.ts` and a
driver). `networking/metrics.ts` is not Prometheus: it holds the network counters that `/stats` and `Client.ts` use, so it stays.

## Verdicts

| Candidate | Where it lives | Verdict | Effort | Why |
|---|---|---|---|---|
| Prometheus exporter | was `features/prometheus.ts` | **Extracted** (`src/plugins/prometheus`) | S, done | Pulled at scrape time, no state, no dependencies. |
| Profile transfer (one-time code and QR) | was `profiles/transfer.ts`, `server.ts`, `screens.ts` | **Extracted** (`src/plugins/transfer`) | M, done | Self-contained. The plain profile code and `#recover=` link stay in the core. |
| Leaderboard | was `profiles/leaderboard.ts`, `server.ts`, client `leaderboard.ts`, nav link, about 20 locale keys | **Extracted** (`src/plugins/leaderboard`) | M-L, done | Needed profile read access and a place for a menu item and a screen (see below). |
| SQLite driver | `profiles/SqliteProfileRepository.ts` | **Extract** (largest weight win) | L | `better-sqlite3` is 12 MB with a native build (compiler in the image, absent on armv6). Needs a store registry that loads before `profiles.init()`. |
| Admin insights, history, reports, time series | `admin/insights.ts`, `history.ts`, `reports.ts`, `timeseries.ts` | **Keep for now** | L | Coupled through `AdminDeps` and the `matchFinished` / `reported` hooks of `Room`; the admin page reads them. Make them optional first. |
| Admin page (`/admin`) | `admin/page.ts` | **Keep** | S | Presentation only, 277 lines, nothing to gain. |
| Tools (loadtest, balance, config-check, gamepack, games) | `src/core/tools/` | **Keep, ship separately** | S | Nothing in the server imports them; the runtime package can leave most of them out. |

## What the two extractions added to the plugin contract

- `rootRoutes` in `plugin.json`: a plugin answers a top-level path (`/metrics`). `PluginHttpRequest.kind` is `'root'` for these.
- `host.stats()` and `host.matches`: counters of the running server, read when asked (no per-tick work).
- Client slot `screen` (a page of its own with a top-navigation button) with the manifest field `clientRoutes`; host `profiles.list()` and
  `games.playableIds()`. See the leaderboard section.
- Client slots `profileSection` (a block in the profile **Info** tab) and `recoveryInput` (another way to adopt a profile, with its
  own `#<hash>=` link). `FeatureContext` for the profile adds `profileKey`, `copy`, `toast` and `qr`.
- The `metrics.enabled` setting is gone. The prometheus plugin has `enabled` (`METRICS_ENABLED`, off by default), set under
  `plugins.prometheus` in the configuration file; it needs a restart. A `metrics:` section left in an old configuration file now
  stops the server with "unknown section".
- Plugin API 2: virtual players (`host.virtualRooms`, the seat methods of the room and `virtualPlayers.authorizeJoin`) are the
  `virtualPlayers` capability a plugin declares in `plugin.json`, instead of being on every plugin's `PluginRoom`. API 1 plugins still
  load with the capability implied (see `plugins.md`).
- The transfer API moved from `/api/profile/transfer` (Bearer header) to `/api/transfer` (`{ "key" }` in the body), because plugins
  do not see request headers.

## The leaderboard: what was in the way, and what was done

1. **A server route.** `/api/leaderboard` was handled inline in `server.ts`, and `leaderboard` was a reserved plugin id. The id is released, so
   the plugin `leaderboard` serves `GET /api/leaderboard` itself (same query, same JSON, same limits).
2. **Every player's stats.** The ranking reads all profiles. The host now has `profiles.list()` (read only, no keys, `null` when the store
   cannot be listed, which the plugin answers with 501) and `games.playableIds(id)` for the per-game filter.
3. **A screen and a menu button.** Plugins now have a `screen` slot (`{ path, navLabel, render(ctx) }`) and the manifest has `clientRoutes`, so
   the server answers the plugin's page with the app. The top navigation is built from the core links plus the plugins' buttons.
4. **Text and settings.** The `leaderboard.*` locale keys moved to the plugin's `locales.es`. `leaderboard.enabled` is gone (leave the plugin
   out of `plugins.enabled`); `leaderboard.top` is `plugins.leaderboard.top` and needs a restart. A `leaderboard:` section in an old
   configuration file now stops the server with "unknown section".
5. **Left in the core on purpose:** the per-day tallies and the shadow-ban flag of a profile (the plugin only reads them), the operator ranking
   of the admin panel (`/api/admin/leaderboard`) and the shadow-ban controls. A server without the plugin still stores the tallies.
6. **Behaviour change:** `/leaderboard` is a 404 while the plugin is not loaded. The static "Top" link of the server-rendered `/rooms` and
   `/status` pages was dropped.

## Extension points still missing (by how many extractions each unblocks)

1. ~~A server event bus~~ done: `host.events.on('matchFinished' | 'resultRecorded' | 'profileChanged')` (a `reported` event is still missing for reports).
2. A store registry (`registerProfileStore`) that loads before `profiles.init()` (read access to profiles exists now).
3. Admin tab and route contribution (insights and reports as plugins).
4. CLI contribution (`build:tools` is a fixed list) and plugin-owned migrations.
5. Plugin-owned settings that can also be changed live from the admin panel (the leaderboard size lost that).

## Low-spec impact

- Measured on the client build: the main bundle went from 1,595,143 to 1,588,750 bytes (about 6 KB raw, 0.9 KB gzipped) after the leaderboard
  screen moved out. The plugins themselves are small and load only when enabled.
- The code that moved is small: `prometheus` is 2.9 KB, `transfer` 1.5 KB (server) plus 1.8 KB (client). Removing them from the
  core saves a few KB of server and client code, and one `TransferCodes` map and one lazily created exporter. This is not where the
  weight is.
- The weight is Phaser (the client is about 1.6 MB, 375 KB gzipped, which no plugin can remove) and the SQLite driver (12 MB on
  disk plus a native build).
- `qr.ts` (about 9 KB) stays in the core because the lobby invite QR uses it; the transfer plugin gets it through `ctx.qr`.
- Pi Zero W numbers are **not measured**: the Pi rows of `BENCHMARKS.md` are still TODO, and no startup time is recorded anywhere.
  Do not quote a saving until they are.

## Suggested order of the follow-up work

1. Measure the Pi Zero W (memory, startup, bundle) so the next steps can be judged.
2. Event bus and a read-only profile API in the host.
3. Store registry, then move the SQLite driver (the image no longer needs a compiler).
4. ~~Make the admin history, reports and insights optional~~ done (`server.adminInsights`, default on). **Decision: they stay in the core for now.** Moving them to a plugin needs two things the contract lacks: a way to contribute `/api/admin/**` routes and an admin tab (`docs/development/plugins.md` says a plugin has none), and room events `matchFinished` / `reported` that reach plugins (`host.rooms.on` only has created / changed / closed, and `host.matches` is pull-only).
