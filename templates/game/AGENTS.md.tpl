# __NAME__ (`src/games/__ID__`)

Guidance for AI agents working on this game. See `docs/development/game-packs.md` for the pack contract.

## Rules

Grab orbs; each is a point; most points when the timer ends wins. Options live in `game.json`; the simulation reads them
through `server/config.ts` (`readOptions`).

## Layout

- `game.json`: catalog, guide, options and translations (es, fr, de, pt, it). Game and variant names are never translated.
- `server/`: `index.ts` (the simulation), `config.ts` (constants), `index.test.ts`.
- `shared/types.ts`: types used by both halves. `client/index.ts`: the renderer.

## AI

This pack has no bot yet, so the bots plugin cannot play it. When adding one, follow rule 6 of the repo `AGENTS.md`
(`bot/`: world model, policy, `levels.ts`, `params.ts`, `incidents.ts`, `sim.ts`, adapters in `bot/variants/`) and add a
"rules contract" test that fails when a variant has no adapter.

## When the game rules change

Update `game.json` (options, guide, every locale), `server/config.ts` and the test. If the pack has a bot, decide whether the
change affects what it perceives, predicts or chooses, and update this file in the same change.
