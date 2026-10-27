# Ballistix: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs; Ballistix's AI is where that pattern started). This file covers what is specific to this pack. `bot/README.md` (repo root) has the long-form AI notes: reports, levels table, variant notes and measured A/B results. This file does not repeat them.

## The game

Up to 4 players (teams of 2), one side of a square field each.

- **Goal:** a ball crossing your side costs a life. The last side with lives wins; at `timeLimit` the most lives wins. Placements give 10/7/5/4/3/2/1 points.
- **Paddle:** slides along its side (`mx`, top speed 620, response 14/s).
- **Returns:** the return angle depends on where the ball touches the paddle (up to 62°), plus 25% of the paddle's velocity. The ball speeds up by `hitGain`.
- **Boost / smash** (`a1`; `a2` in Sand Orb): a pulse that pushes nearby balls away, faster, with a cooldown.
- **Balls:** they launch from the corners.

**Code:** a core rule set (`server/core/`: `BallArena`, geometry and constants, physics, options) plus **variant modules** (`server/variants/`; `module.ts` defines the `ArenaApi` a module sees).

| variant | modules |
|---|---|
| `smashball` | the baseline |
| `sand-orb` | slow balls with drag; `a1` is a magnet (hold to pull and catch up to two balls, release to launch them aimed by the paddle's velocity; a plain release is `releaseGain` 1.3x faster, a boosted one is unchanged); boost on `a2` |
| `pulse-ball` | a ball-bot in the centre that fires balls; the repel power-up |
| `cloud-orbs` | engine failures that pull balls to a corner |

**Host options:** per variant in `game.json`: lives, balls, speeds, smash, paddle length, spawning, collisions, `timeLimit`, and each module's own options. Every timer has a `<name>Variance` in seconds (+- via `nextIn`): `spawnDelayVariance`, `ballSpawnVariance` (both were the fraction `spawnJitter`), `enemyVariance`, `enemyDurationVariance`, `repelVariance`, `repelItemVariance`, `repelDurationVariance`, `failVariance`, `failDurationVariance`. Snapshot ratios (`left`, `life`) use the length drawn for that appearance. The bot's `engineFail`/`repelDuration` use the nominal mean, which is right on average.

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame` → `createBallArena(applyOptions(variant, options), seed)` (`server/arena.ts`, `server/variants/index.ts`). `bot` is `greedyBalls` (`server/bot.ts`, for `npm run balance`). `ai` is `ballistix` (`bot/index.ts`).
- **Snapshot** (kind `ext:ballistix`, `shared/types.ts`): sides (lives, used, alive), paddles (side, `pos`, `len`, readiness `d`), balls (position, radius, `wait` in a launcher, `boost`), and per variant `magnet`, `enemy`, `repel`, `engines`. It carries no velocities.
- **Events:** `hit` (paddle hit), `goal` (life lost, `id` = the side's player), `smash`, `spawn`, `eliminated`.
- **Shared geometry:** `shared/geometry.ts` (`rotQuarter`, corners). The client is `client/BallistixRenderer.ts` and `client/views/*` (one view per module).
- **Checks:** `packs.test.ts`, `render.test.ts`, `gamepack validate`.

## The bot (`bot/`)

**One decision:** `index.ts` → `WorldModel` (`world.ts`) → `PredictivePolicy` (`policy/predictive.ts`) → the variant adapter's `refine` → input.

- **Perception** (`world.ts`):
  - everything is turned into the bot's own frame (its goal at the bottom);
  - ball velocities come from `kit/track` with a bounce-aware `advance`;
  - which edges are living goals;
  - the obstacles, pulls and repulsors of the variant.
- **Prediction** (`physics.ts`): projects each ball to the paddle plane with wall and corner bounces (`project`). The constants come from `server/core/geometry.ts`; the corner bounce mirrors the server.
- **Policy `predictive`:**
  - takes the soonest reachable threat and angles the return at the weakest opponent (`aim`);
  - boosts to save a ball it cannot reach, or when one is close (`smashDist`).
- **Policy `greedy`:** goes under the nearest ball.
- **Adapters** (`bot/variants/`): `Physics` (drag, speed limits, engine pull, repel force) and `refine` (Sand Orb's magnet).

**Levels** (`levels.ts`, the table in `bot/README.md`): reaction, paddle speed, aim noise, lapses, bounces read (`maxBounces`), boost use, aiming, magnet share.

Incident causes (`incidents.ts`; one per life lost) and their knobs (file `bot/`):

| cause | meaning | knobs |
|---|---|---|
| `never-predicted` | ball not projected to the goal (bounce off a paddle or ball, unknown velocity) | `maxBounces`, `horizon`; unmodelled bounces in `physics.ts` |
| `mispredicted` | projection off by more than the half paddle | `physics.ts` for strong levels; `noise` for weak |
| `unreachable` / `double-threat` | seen too late, or busy with another ball | `reactionMs`, `speed`, `gain`; multi-ball handling in `policy/predictive.ts` |
| `wrong-ball` | switched target in the last 300 ms | ball selection in `policy/predictive.ts` |
| `paddle-lag` | reachable and predicted, paddle not there | `gain`, `speed`, `deadband` |
| `clipped` | in range yet scored | `aim`/`aimMax`, `smashSave` |

**Commands:**
- Tests: `npx vitest run src/games/ballistix`.
- A/B: `bot/sim.ts` (`variantAware` 1 vs 0).
- Ladders: `bot/scenarios/ladder.json`, `ladder-<variant>.json`.
- Tuning: `/bot-tune`.

## Considerations

- The side is the frame: a bot works in its own rotated frame, so any server change to side layout or `rotQuarter` breaks the world model first.
- Never model your own paddle's effect on the ball (the bot would chase its own prediction). This is why its own repulsion is left out in Pulse Ball.
- Fetching Pulse Ball's repel item was measured and does not pay, so it is not played.
- **Teams:** the bot defends its own side only. `allies` is not used: a team shares nothing in Ballistix's rules beyond the score.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| paddle movement and constants (`server/core/geometry.ts`) | imported by `bot/physics.ts`; `policy/predictive.ts` uses them |
| ball physics: bounces, corners, speed limits, hit angle and gain (`server/core/physics.ts`, `BallArena.ts`) | `bot/physics.ts` (`advance`, `project`, corner bounce: a copy) |
| boost / smash rules | `policy/predictive.ts` (smash decisions), `index.ts` (button timing) |
| a variant module's constants (drag, pull, repel, magnet) | `bot/variants/<variant>.ts` `physics` / `refine`; `physics` is built from the exported server configs and constants (`sandOrb`, `cloudOrbs`, `pulseBall`, `BALL_CEIL`, `ENGINE_WARN`/`ENGINE_RAMP`), never copied |
| sides, lives, snapshot fields | `world.ts`, `incidents.ts` |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above. The corner bounce in `bot/physics.ts` is a copy of the server's; keep it in step.
3. New variant: add an adapter and `ladder-<variant>.json`. An unknown variant plays as smash ball.
4. Input changes: `index.ts` (the boost button, Sand Orb's `a2`).
5. Run `npx vitest run src/games/ballistix` and `gamepack validate`.
6. Run the ladders and `/bot-tune`.
7. Update this file and the Ballistix sections of `bot/README.md`.

## Bot sync (2026-10-26)
- Speed ceilings come from the variant config for every variant (`bot/variants/limits.ts`): a free ball is clamped to `ballMaxSpeed x BALL_CEIL`, a smashed one up to `smashCeilOf(smashGain)` easing back with `boost` (`BOOST_DECAY`). `Ball.boost` is carried through `project`/`advance`. Bumpers and the enemy body add 5 % speed like `bounceCircle`.
- Teams: the paddle lane is `[laneL, laneR]` from the number of paddles on our side and our index in the snapshot (same maths as `BallArena`), not the whole goal. A `goal` event names the first paddle of the side that conceded, so incidents compare against that id.
- Known limits (option-dependent, not in the snapshot): `holdTime`, `failPull`, `repelForce`, `repelDuration`, `ballMaxSpeed`, `ballSpeed` use the variant defaults.
