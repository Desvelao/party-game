# Crazy Logs: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs). This file covers what is specific to this pack.

## The game

Players hop across a river of spinning logs, from the start bank (y ≥ 840, restart at y 875) to the far bank (y ≤ 190), as many times as they can in `timeLimit` (60 s).

- **Scoring:** each landing on the far bank is a point and sends the player back to the start.
- **Water:** falling in costs time (sinking for `respawnTime`), not points.
- **Placement:** points, then fewer falls; leavers are last.
- **Variants:** there are none. Hosts shape the game with options instead.
- **Teams:** `teams: true`, max 4 per team. No team logic: teammates shove each other and spin each other's logs.

**Logs and spin** (`server/CrazyLogs.ts`):
- `logCount` logs (4 to 8) lie across the river, evenly spread from y 760 to 260 (`logsLayout`), each `logSize` thick. Their surface moves along y.
- Standing on a log adds `offset × standTorque × dt` to its spin, where offset is −1 at the far edge and +1 at the near edge. Landing on it adds `offset × landImpulse`. Both feed themselves: the near half spins the log towards the start, the far half towards the far bank.
- Spin is capped at `maxSpin` and fades at `spinFade`. `stability` scales both pushes.

**Input:**

| control | effect |
|---|---|
| stick | walk at 190 px/s on the ground. On a log, y also drifts by the log's spin |
| `a1` **held** | hop when ready: towards the stick (if longer than 0.3), else straight up. `hopDistance` (100) px in 0.3 s, then a 0.2 s cooldown. The landing point is fixed at take-off |
| `a2` | unused |

**Landing:** a landing within 16 px of a log or bank snaps onto it. Walking past a log end (x < 90 or x > 910) or off its edge is the water.

**Jets** (option `jets`): every `jetInterval ± jetVariance` s a jet warns for 1 s on a log, then knocks players within 80 px away (`jetForce`) and kicks that log's spin either way.

**Host options:** `timeLimit`, `stability`, `maxSpin`, `spinFade`, `respawnTime`, `logCount`, `logSize`, `jets`, `jetForce`, `jetInterval`, `jetVariance`, `hopDistance`. `respawnVariance` (+- s on the fall penalty; the snapshot's `w` is relative to the length drawn for that fall).

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame` builds `CrazyLogs(applyOptions(options), rng)`. `bot` is the greedy hopper of `server/bot.ts` (used by `npm run balance`; it assumes the default layout). `ai` is the bot.
- **Snapshot** (`shared/types.ts`, kind `ext:crazy-logs`): rows (spin `v`, stripe phase, centre `y`), `half` (half thickness), jets (warning `w`, erupted `e`), players (`x`, `y`, facing, hop progress `h`, readiness `d`, score, falls, sinking `w`). It carries no velocities or hop target, and has no private state.
- **Events:** `dash` (hop), `bank` (point), `splash` (in the water), `jet`.
- **Catalog and i18n:** `game.json` holds the options, with the translations in `locales` (`es`, `fr`, `de`, `pt`, `it`); `tr()` in the client.
- **Client:** `client/CrazyLogsRenderer.ts`, `client/track.ts`.
- **Checks:** `packs.test.ts`, `render.test.ts`, `gamepack validate`.
- **Character:** players are drawn with `ctx.drawCharacter`, using the `blob` model of the `characters` plugin (`"character": "blob"` in `game.json`); the game is skipped when that plugin is not loaded. Looks never reach the snapshot, so the bot is unaffected.

## The bot (`bot/`)

**One decision:** `index.ts` → `WorldModel` (`world.ts`) → `HopperPolicy` (`policy/hopper.ts`) → input.
- The bot knows **its own position from the newest snapshot** (a person knows where they stand).
- It sees the river (spins, jets, other players) `reactionMs` late.
- During a lapse it keeps the stick as it was. On a spinning log a released stick means a fall, and a person who drifts off does not let go either.

**Perception** (`world.ts`):
- the ground under the bot;
- other players on the ground;
- two option-dependent numbers the snapshot does not show, **learned from its own hops**:
  - the hop length, from two mid-air samples (the server moves a hop linearly with `h`);
  - the landing impulse, from the spin change of the log it lands on.

**Constants:** walk speed, hop time, cooldown, landing assist, radius and jet radius/warning are imported from `server/CrazyLogs.ts`. `groundAt` mirrors the server's.

**Policy `hopper`:**
- **Target:** the next log, or the far bank.
- **Landing offset:** chosen so the landing cancels that log's spin, `o = −v / landImpulse` (scaled by `spinAware`), plus `noise`.
- **Aiming the hop:** a hop flies `hop` px towards the stick, so the stick's angle sets how far along the river it lands (`dy = hop · uy`), and the sideways part steers back into the lane.
- **Side check:** it picks the side that keeps the landing away from the log ends, jets about to erupt (`jetAware`) and other players (`crowd`).
- **Walking:** while it cannot reach, it walks to a spot it can hop from, against the spin.
- **Escape:** when the spin is about to carry it off, it walks back to the middle.
- **Wide gaps** (few logs): it stands at the very far edge and aims for the near edge of the next log, inside the 16 px landing assist.
- **In the air:** it holds the stick towards the middle of the log it lands on, so walking starts on the landing tick (a landing near an edge spins the log that way).

**Policy `greedy`:** wraps `server/bot.ts`.

**Levels** (`levels.ts`): reaction, lapses, walk speed (`speed`), landing `noise`, `spinAware`, `jetAware`, `edgeMargin`, `hesitate` (delay after the hop is ready), `crowd`.

Incident causes (`incidents.ts`; one per fall) and their knobs:

| cause | meaning | knobs |
|---|---|---|
| `missed-landing` | a hop came down in the water (often a landing at an edge that spun it straight off) | `noise`, `spinAware`, the wide-gap logic and `inAir` in `policy/hopper.ts` |
| `spun-off` | the log's spin carried it over an edge | `spinAware`, `edgeMargin`, `speed`, `lapse` |
| `x-edge` | walked or was pushed off a log end | the lane limits in `policy/hopper.ts` |
| `shoved` | another player was against it | `crowd` |
| `jet` | a jet erupted next to it | `jetAware` |

**Commands:**
- Tests: `npx vitest run src/games/crazy-logs`.
- A/B: `bot/sim.ts`. It takes `options` (try `logCount: 4`, `hopDistance: 70/130`, `stability: 0`, `jets: true`).
- Ladders: `bot/scenarios/ladder-crazy-logs.json` (default options) and, one per option set the AI plays differently, `ladder-crazy-logs-jets.json`, `-long-hop.json` and `-few-logs.json`. The game has no variants (so no `bot/variants/`): these are options, which `crazy-logs.test.ts` also plays.

## Considerations

- **Measured** (4 bots, default options): crossings per round of about 15 / 12 / 10 / 6 from semigod down to easy; greedy 0 (it hops sideways into the water).
- **Calibration:** the ladder reads 100% for every pair. A near-deterministic race lets any skill gap win every time, so judge levels by crossings per round instead.
- **Known limits:**
  - Other players landing on the bot's log (which change its spin) are not predicted. With 4 logs, alone the bots are fine; in a full room even hard falls often.
  - Jets shift a hop in flight, which is not modelled.
- **Input:** `a1` is held, not a press, and the server hops whenever it is down and the hop is ready. The bot holds it for one decision and then keeps it locked for 150 ms, so one press is one hop.
- **Stick:** the vertical stick (`my`) must reach the server; the bots plugin's brain sends it.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| hop (distance option, time, cooldown, landing assist, direction from the stick) | `bot/world.ts` (hop learning), `policy/hopper.ts` (aiming, `inAir`), `physics.ts` imports |
| spin rules (`landImpulse`, `standTorque`, `stability` in `server/config.ts`) | `world.ts` (impulse learning), `policy/hopper.ts` (landing offset), `DEFAULT_LAND_IMPULSE` |
| ground and edges (`groundAt`, banks, log ends, `logsLayout`) | `physics.ts` `groundAt`, the lane limits in `policy/hopper.ts` |
| walking (speed, drift on a log) | `policy/hopper.ts` walking |
| jets | `policy/hopper.ts` (`pickSide`, the walk-away), `incidents.ts` |
| snapshot fields | `world.ts` |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above.
3. Variants added later: create `bot/variants/` following another pack (Frost Shove), with adapters and a ladder scenario per variant.
4. Input changes: `index.ts` (the hop lock) and the rules-contract test (`a1` held hops `hopDistance` towards the stick).
5. Run the tests and `gamepack validate`.
6. Run an offline ladder and `/bot-tune`.
7. Update this file.
