# AGENTS.md

Guidance for AI agents working on this repo. See `README.md` for full docs.

## The game

**Bonk Arena Party**: a lightweight, server-authoritative multiplayer party game for browsers.
Players join rooms with a 4-letter code (phones as controllers/players, spectators via watch links),
and play minigames: 8 families / 27 variants, each with host-adjustable options, played singly,
in order, mixed, or as a custom playlist. No accounts: profiles (name, colour, character, stats,
language) are stored server-side.

Stack: Phaser 3 + Vite client, Node.js + `ws` server, JSON protocol, TypeScript.

- `src/core`: the engine. It contains no game; every game is an installable pack.
  - `src/core/client`: Phaser client and UI
  - `src/core/server`: rooms, game loop, networking, profiles, admin, pack loader
  - `src/core/shared`: code used by both (catalog, options, i18n, locales, pack contracts)
  - `src/core/tools`: CLI tools (loadtest, balance, admin, migrations, config check, gamepack, scaffold, playtest, games)
- `src/plugins`: one folder per plugin (`plugin.json` + `server/` + `client/`), e.g. `characters` (the `blob` character model), `bots` (AI players), `prometheus` (`/metrics`), `transfer` (profile transfer code), `leaderboard` (the Top page), `progression` (XP, levels, achievements). Plugins add features to the core through the contract in `src/core/shared/plugins.ts`; the core never imports a plugin. See `docs/development/plugins.md`.
- `src/games`: one folder per game pack (`game.json` + `server/` + `client/` + `shared/`), e.g. `ballistix`, `frost-shove`,
  `spring-showdown`, `box-bonanza`, `sprint-smash`, `crazy-logs`, `tank-wars`, `rumble-cards`. A pack imports from the core
  only types and the stateless helpers in `src/core/shared/kit`; the core never imports a pack. Every pack has its own
  `AGENTS.md` (`src/games/<id>/AGENTS.md`): the game's rules, how it plugs into the core, its AI and what to check in the
  AI when the rules change. Read it before changing a game.
- Characters: the core ships no character model. Games and plugins register models (`characters` in `game.json` /
  `plugin.json` + draw code), a game names the one it uses (`"character"` in `game.json`; skipped when missing), and the
  profile keeps one look per model (`looks`) plus an `avatar` model. See "Character models" in `docs/development/game-packs.md`.
- `docs/manual`: the user manual (installation, deployment, configuration, administration, playing); `docs/admin-api.md` and `docs/deploy-image-transfer.md` are reference docs next to it
- `packaging/`: native Linux packages (tar.gz, deb, rpm) with a bundled Node.js, built by `packaging/build-package.sh` and `.github/workflows/packages.yml` (`docs/development/packaging.md`). A new `dist/*.js` tool needs a launcher entry there.
- `docs/development`: developer docs (e.g. `plugins.md`, the plugin format and contract; `balance-testing.md`, the `npm run balance` playtesting tool; `game-packs.md`, the installable game pack format and the `gamepack`/`games` tools; `core-extraction-report.md`, which core features could become plugins and what the plugin contract still lacks)

## Development rules

1. **i18n for all UI strings.** Never hardcode user-visible text.
   - UI text: `t('key', params)`, adding the key to `src/core/shared/locales/en.ts` and to **every** other locale file there (`es.ts`, `fr.ts`, `de.ts`, `pt.ts`, `it.ts`) with the same `{placeholders}`.
     Languages are `LANGS` in `src/core/shared/i18n.ts`; a test (`i18n.test.ts`) fails on a missing key, a changed placeholder or an untranslated catalog text in any language.
   - English catalog/option text of a game: written in its `game.json`, with the translations in `locales.<lang>` of the same file (`es`, `fr`, `de`, `pt`, `it`)
     (`tr(english)` in its client code uses the same table). The core's own catalog texts are in `src/core/shared/locales/catalog.ts` (`CATALOGS`, one table per language).
   - Multilingual data (guides): `Localized` (`{en, es, fr, de, pt, it}`) + `loc()`.
   - Game and variant names are never translated.
2. **Must run on low-spec hardware**: Raspberry Pi Zero W, mini PCs, and regular servers/PCs.
   - Keep the server CPU- and memory-light: no per-tick allocations in hot paths, no heavy dependencies, small snapshots.
   - Respect the `PROFILE` (`LOW_POWER` | `NORMAL` | `HIGH`) tick/network rates and limits; never assume a fast machine.
   - Check `BENCHMARKS.md` / `npm run loadtest` when touching the game loop or networking.
3. **Mobile first UI.** Design for phone portrait and touch (joystick / 4-way cross) first, then scale up to desktop.
   No hover-only interactions; keep assets and bundle small.
4. **Keep the user manual current.** `docs/manual/` documents the game for players, hosts and operators
   (index: `docs/manual/README.md`). When a change affects what a user sees or does (UI labels, flows,
   settings, defaults, commands, deployment), update the matching manual file in the same change.
   - Tone: a manual for users. Second person, short task-oriented numbered steps, plain words, no code
     internals; say what to click or type and what happens next.
   - Use the exact on-screen wording from `src/core/shared/locales/en.ts` (bold for buttons), and verify commands
     and defaults against `package.json`, `src/core/server/config.ts` and `config.example.yaml`; never invent them.
   - One topic per file; link to `docs/admin-api.md` and the README instead of duplicating them.

5. **Plugin routes.** A plugin's API endpoints are registered under `/api/<plugin_id>/**` and its pages under `/plugins/<plugin_id>/`
   (`docs/development/plugins.md`). A plugin id may not shadow a core API namespace (`admin`, `profile`, `stats`...), and plugin
   routes are admin-guarded through `req.admin` unless they are deliberately public.
6. **Game AI: one shared AI per game pack, variants are adapters.** Every pack has one bot (`src/games/<id>/bot/`: world model,
   prediction, policy, `levels.ts`, `params.ts`, `incidents.ts`, `sim.ts`), exported as the pack's `ai`. Do not write a bot per variant.
   A variant adds a thin adapter in `bot/variants/`: what the snapshot does not carry (server constants such as Ballistix's drag, or
   the variant's flags read from the pack's own `server/config.ts`) and an optional `refine()` for the variant's own action (Beach
   Ball's magnet, Swamp Fox's shield). The world model reads the variant from `state.variant` (`AiContext` has none, so router/brain
   stay variant-agnostic). Why: variants are the baseline rules plus modules, so most of the AI is common and one ladder/tuning loop
   (`/bot-tune`) stays valid.
   - New variant: add its adapter and a `bot/scenarios/ladder-<variant>.json`; an unknown variant falls back to the baseline.
   - Variant skills are params gated per level, so `easy` stays easy everywhere. `variantAware: 0` plays any variant as the baseline,
     for A/B runs (`bot/sim.ts` plays headless rounds through `core/shared/kit/botsim.ts`).
   - Keep a variant feature only if A/B shows it does not lose (dropped so far: fetching Pulse Ball's repel item), and never
     model your own effect on what you predict (the bot would chase its own prediction).
   - Import the server constants the bot predicts with from the pack's own server code (export them there); never copy them.
   - Build levels from the human handicaps in `core/shared/kit/humanize.ts` (reaction time, lapses) plus the game's own knobs;
     teammates come in `AiContext.allies` (games have no teams: friendly fire is on).
   - Reimplement (a new `policy` in `policies[]`) only if a variant breaks the policy's core assumption.
7. **Rule changes reach the bot.** A change to a game's rules, physics, inputs, items, variants, options or snapshot must be checked
   against that game's AI, which may need adjusting. Follow the "When the game rules change" checklist in
   `src/games/<id>/AGENTS.md`: decide whether the change affects what the bot perceives, predicts or chooses, update the files it
   points to, and update that `AGENTS.md` in the same change. Each pack's "rules contract" test fails on the common cases (a new
   variant, a changed input, a moved constant) to remind you.
8. **Admin operations come in three forms.** Anything an operator can do must be available through the CLI (`npm run admin`,
   `src/core/tools/admin.ts`), the HTTP API (`/api/admin/**`, `docs/admin-api.md`) and the admin UI (`/admin`,
   `src/core/server/admin/page.ts`). When you add or change an admin operation, implement all three in the same change, with
   tests for each, and update `docs/admin-api.md` and `docs/manual/administration.md`.

9. **Timed options come with a variance.** Every "X every" / duration option that a host can set gets a companion `<name>Variance`
   (seconds, +-, same `group`, default 0 unless it keeps an older fixed spread). Read both through `nextIn(rng, every, variance, minGap)`
   in `src/core/shared/kit/util.ts` (no rng draw when the variance is 0). If a snapshot sends a progress ratio, divide by the length
   drawn for that event, not the configured mean. Renamed option ids go in `OPTION_ALIASES` (`src/core/shared/catalog.ts`).

## Workflow

- `npm run check` (typecheck + tests) must pass; CI runs it on every push.
- Dev environment: `docker compose up` (see README for details).
- New config options: update `config.example.yaml` (`npm run config:example`) and the README table.
- New or changed user-facing behaviour: update `docs/manual/` (rule 4).
- Changed game rules: review the pack's bot and its `AGENTS.md` (rule 7).
