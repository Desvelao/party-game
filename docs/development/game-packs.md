# Game packs (developer guide)

A game is a **pack**: a gzip'd tar called `<id>-<version>.pgpack` holding

| File | What |
|---|---|
| `game.json` | Manifest: id, name, version, `apiVersion`, author, license, description, `catalog` (what the host UI and validation need), optional translations (`locales`: `es`, `fr`, `de`, `pt`, `it`), sha256 of the code files. |
| `server.mjs` | Bundled ESM, default export `ServerGamePlugin`: `createMinigame(playableId, options, rng)`. |
| `client.mjs` | Bundled ESM, default export `ClientGamePlugin`: renderer, HUD, effects, ranking, music. |
| `README.md` | Optional. |

The core has no game of its own: every game, including Ballistix, Frost Shove, Spring Showdown, Box Bonanza and
Sprint Smash, is a pack under `src/games/`. The server loads packs at startup from `dist/games` (the ones built with
it, from `npm run build`) and `<dataDir>/games` (installed later), see
[manual/installing-games.md](../manual/installing-games.md). Nothing is compiled on the server: packs are
prebuilt JS, so they work in the read-only production image. Tests and the balance tool run the games straight from
their source: `registerSourceGames()` in `src/core/server/plugins/sourceGames.ts` registers every folder under
`src/games/`, and `src/core/test-setup.ts` calls it for the whole test run. The tests of a game sit next to its code.

## Write a game

```bash
npm run gamepack -- init orb-grab --name "Orb Grab"     # src/games/orb-grab from templates/game
npm run gamepack -- validate src/games/orb-grab             # headless run with bots
npm run scaffold -- game orb-grab                            # same as init: server, config, test stub, shared types, AGENTS.md, all translations
npm run scaffold -- variant orb-grab orb-rush --action dash  # add a variant (catalog entry + guide) to game.json
npm run playtest -- orb-grab --script script.json --trace    # one headless round with scripted inputs
npm run gamepack -- build src/games/orb-grab                # dist/packs/orb-grab-0.1.0.pgpack
npm run games -- install dist/packs/orb-grab-0.1.0.pgpack
```

Contracts (types only, import with `import type`):

- Server: `src/core/shared/plugin-api.ts` (`Minigame`, `ServerGamePlugin`, `GameManifest`). The core owns the lobby,
  countdown, scoring and networking; the game owns the simulation and returns `getPlacements()` (every initial
  player exactly once, also players who left).
- State: `getState()` returns a plain JSON object with `kind: "ext:<name>"` and `t` (seconds). It is sent to every
  client every network tick, so keep it small (limit 16 KB, aim for a few hundred bytes).
- Events: `drainEvents()` returns `{ kind, id, x, y }`. Use the core kinds (`hit`, `explode`...) for free effects or
  `ext:<name>` kinds that the client plugin handles in `event()`.
- Client: `src/core/client/src/plugins/api.ts` (`ClientGamePlugin`, `ClientContext`). A pack never imports Phaser: draw on
  `host.g`, get labels from `host.label(id)`, and use `ctx.lerp`, `ctx.clamp`, `ctx.sfx`, `ctx.colorOf`. Scale purely decorative movement (bobbing, drifting clouds) by `ctx.motion()` (0, 0.4 or 1, from the player's motion setting and the OS reduced-motion flag).
- Messages from players: a server `Minigame` may implement `handleAction(playerId, data)` to receive the game-defined
  messages a client plugin sends with `ctx.send(data)` (`GAME_ACTION`). `data` is a plain JSON object of at most 512
  bytes, 16 keys per object and 3 levels deep; the core only checks that, so the game validates the content. Spectators
  and players sitting out cannot send actions, and actions only arrive while the round is playing (not in the countdown).
- Rejoining: `addPlayer({ id, name })` is optional. The core calls it when a player who was in `init()` reconnects during
  the countdown or the round (after it called `removePlayer` for them); put them back in play and ignore unknown ids.
  Without it they sit that round out. They must still appear exactly once in `getPlacements()`.
- Stats: `getStats()` is optional and is called once when the round ends. It returns `{ [playerId]: { [name]: number } }`
  with a few finite numbers per player; the core sends it in the round result (`GAME_RESULT.stats`). It is not saved to profiles.
- Private state: `getPrivateState(playerId)` returns what only that player may see (e.g. a hand of cards). The core
  sends it as `GAME_PRIVATE` after every public snapshot, but only when it changed, and never to spectators. Keep it
  under 2 KB. A player who reconnects mid-round sits that round out (unless the game implements `addPlayer`, see below), so they get no hand until the next game.
- Phone controls: a client plugin may implement `controller(el, ctx)` to draw its own controls in `el` for players
  (spectators never get it). It returns `{ update(publicState, privateState), destroy() }`; while it is mounted the
  core hides the joystick, cross and action buttons. Update the DOM only when something changed, not on every call:
  `update` runs every network tick. A pack still needs a renderer for the shared screen. See `src/games/rumble-cards`.
- Sounds: besides `ctx.sfx(name)` (the core's fixed effects), a pack can play its own with `ctx.sound(steps)`. A sound is
  data, like music: up to 10 voices, each a `tone` (`f` Hz, `d` seconds, `type`, `g` gain, `to` Hz to glide to, `at`
  seconds of delay) or a `noise` burst (`from` -> `to` Hz filter sweep). The core limits every value (40-8000 Hz, at most
  1.5 s and 0.35 gain per voice, 12 sounds per 200 ms), so a pack cannot get loud or heavy. `src/games/rumble-cards/client/sounds.ts`
  has examples, and a game event that arrives with a hit can be played a moment later to match an animation.
- Buttons: a client plugin's `actionLabels(state, ctx)` returns `{ a1, a2? }`, the texts of the action buttons (`a2` shows
  the second button), and `controllerKeepsControls: true` keeps the joystick or cross and the buttons on screen with
  the `controller` drawn above them. The game still receives them as `INPUT`; act on presses (an edge), not holds.
- Shared-screen DOM: a client plugin may implement `overlay(el, ctx)` to draw HTML over the arena for everyone, spectators
  included (scoreboards, cards...). It returns `{ update(publicState, null), destroy() }`. The layer ignores touches, so
  the canvas and controls below keep working. Like `controller`, rebuild the DOM only when something changed.
- Characters: see "Character models" below. Draw a player with `ctx.drawCharacter(g, id, x, y, r, facing)` and name the
  model in `game.json`.
- Card art: `src/games/rumble-cards/client/art.ts` draws illustrations as inline SVG, since packs ship no image files.
- Tags: `tags` on the catalog game (and optionally on a variant, which then replaces the game's) lists the game's tags from the fixed vocabulary `GAME_TAGS` in `src/core/shared/catalog.ts` (`last-standing`, `race`, `points`, `turn-based`, `ball`, `vehicle`, `hazards`). The room-creation and playlist screens show them as chips and filter by them; the labels are the UI strings `tag.<id>` in every locale. To add a tag, extend `GAME_TAGS` and add the string in `en.ts` and in each other locale file.
- Catalog: `touchHint` (optional `{en, es, fr, de, pt, it}`) adds a note under the touch-controls settings; a client plugin's `moveControl(state)` picks the suggested control while playing. Options need unique ids per game, a `type` (`number`, `boolean`, `choice`), a `default`, and a `group`
- Timed options: give every interval or duration option a `<name>Variance` companion (seconds, +-) and read both with `nextIn` from `core/shared/kit/util` (AGENTS.md rule 9).
  if they should not appear under "match". Texts are English; give the translations in `locales.es`, `locales.fr`, `locales.de`, `locales.pt` and `locales.it` (the English sentence is
  the key; a language you leave out shows the English text). Game and variant names are never translated.

## Character models

The core ships no character. A game pack or a plugin registers **models**, and a game says which one its players are
drawn with; several games can share one model (the built-in games use `blob` from the `characters` plugin). Players
customize each model in their profile and keep one look per model.

- **Provide a model**: list it in `characters` of `game.json` (or `plugin.json`): `{ id, name, slots: [{ id, label,
  options: [{ label, swatch? }], default }] }` (at most 8 models, 16 slots, 2-32 options each; `swatch` is a 0xRRGGBB
  colour shown next to the option). The server checks players' looks against these slots without running any code.
  Then draw it in the client code: `characters: { <id>: (look, color, r, facing) => Shape[] }` in `ClientGamePlugin`
  (or `ClientPlugin`). `look` is `{ <slot id>: <option index> }`, always complete; `color` is the player's colour;
  return the shapes centred on (0,0) with body radius `r`, the body first (the core outlines it). `shapePen(r, facing)`
  in `core/shared/kit/shapes.ts` builds them in units of `r` along the facing; types are in `core/shared/kit/looks.ts`.
- **Use a model**: set `"character": "<model id>"` in `game.json` and call `ctx.drawCharacter`. When no installed game
  or plugin provides that model, the server skips the game at start-up and logs why. A game without `character` draws
  no characters (`ctx.drawCharacter` then draws a plain body in the player's colour).
- **Texts**: the model `name` and slot `label`s are English, translated with `locales` like the catalog. An option is
  looked up as `"<slot label>: <option label>"` first (so "None" can differ per slot), then as its bare label.
- A model id is unique on the server: the first owner to load keeps it, a later one is logged and ignored. A model owned
  by a game pack makes the client load that pack's code to draw it in the profile, so a plugin is the better home for a
  model several games share.

## The AI (optional)

A pack may export `ai` (a `GameAi`, `src/core/shared/ai.ts`) next to `createMinigame`: levels, policies, parameters and a `create()` that returns a brain playing one round from the snapshots a player receives (`onState`, `onEvents`, `decide`, and optionally `onPrivate`, `trace`, `metrics`). The bots plugin and the bot server play with it; a game without `ai` gets no bots. Keep `decide` cheap, because it runs on the game server (`gamepack validate` plays the AI against a random opponent and fails above 5 ms per decision), and import only types and `core/shared/kit` helpers. Every built-in pack ships one, laid out the same way (`src/games/<id>/bot/`: world model, policy, `levels.ts`, `params.ts`, `variants/`, `incidents.ts`, `sim.ts`); each pack's `AGENTS.md` describes its AI and what to check in it when the game's rules change.

What the host gives a brain:

- `AiContext.allies`: the bot's teammates while the room plays in teams. Games know no teams, so an AI that should not hit its own side reads this.
- The private state (`getPrivateState`, e.g. a hand of cards): it reaches `onPrivate`, also when it arrives before the first snapshot.
- Both stick axes (`mx`, `my`), rounded to 0.01. Buttons are sent when they change, so a game that reads press edges needs the button released in between: `EdgeButton` in `core/shared/kit/humanize.ts` times that, next to `ReactionBuffer` and `Lapses`, the human-like handicaps the levels are built from.

`core/shared/kit/botsim.ts` (`playBots`) plays a headless round with brains in every seat, as a phone would see it. Each pack's `bot/sim.ts` wraps it for its tests and A/B runs.

## Develop from source

`docker compose up` (or `npm run dev:server` + `npm run dev:client`) runs the games and plugins under `src/` straight from their source, with no build step (`DEV_SOURCE=1`, `src/core/server/plugins/sourcePacks.ts`):

- Server code: tsx loads `server/index.ts`; editing any file it imports (or the ``game.json``) restarts the server. Rooms are lost on a restart, profiles are not.
- Client code: Vite serves `client/index.ts` as `/games/<id>/client.mjs`, so a change reloads the page.
- The pack checks of `npm run build:games` (no core imports at runtime, size warnings) do not run in this mode, so run `npm run check` before you push. `npm run dev:server:built` starts the server the old way, from built packs.

## Rules the tools enforce

- Stateless helpers a pack may import and bundle: `src/core/shared/kit/` (`util`: `clamp`, `r1`, `r2`, `LastStandingTracker`...; `collision`; `looks` and `shapes` for character models; `track`, `humanize` and `botsim` for AIs), plus `shared/types`, `shared/constants` and `shared/catalog` for types.
- `gamepack build` fails when the code imports core modules that hold state (`shared/index`, `catalog`, `character`, `i18n`,
  anything under `src/core/server` or `src/core/client`, Phaser). Type imports are fine; small helpers (geometry) are copied
  into the bundle.
- `gamepack validate` plays each playable with 2 and up to 4 random bots until the round ends and checks: state
  `kind` starts with `ext:` and `t` is a number, snapshots stay under 16 KB, placements are complete (a player
  who left included), the round ends within 10 minutes of game time and `update()` averages under 10 ms.
  Warnings: snapshots over 6 KB, `update()` over 2 ms (a Raspberry Pi Zero is about 10x slower than a PC).
- The loader checks every file against the sha256 in `game.json` and skips a broken pack without stopping the
  server.

## Security

Server code in a pack is **not sandboxed**: it runs inside the server process. Packs are installed by the operator,
who is shown the author and fingerprint first. Isolating packs (worker threads, a VM) costs CPU and memory on the
smallest devices and is future work.

## Limits of API version 1

JS only (no image or audio files; graphics are drawn with Phaser Graphics and music is data), actions limited to the
core's set (`dash`, `boost`, `grab`, `kick`, `charge`, `fire`, `act`, `mine`), restart needed after install or
uninstall.
