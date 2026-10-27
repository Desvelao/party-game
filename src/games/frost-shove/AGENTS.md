# Frost Shove: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs). This file covers what is specific to this pack.

## The game

Bears on a round ice floe (centre 500,500, 16 sectors, radius 400) push each other into the water. The last bear on the ice wins.

- **Shrinking floe:** over the second half of `timeLimit` the floe shrinks to radius 130 (`smoothstep`).
- **Falling in:** a bear falls in when it is further from the centre than `min(globalR, polarEdge(sectors, angle)) + 0.35 r`.
- **Ledge or plunge:** what happens on crossing that line depends on the outward speed (`LEDGE_SPEED` = 400 px/s). Slower (walking off, the shrinking rim, a weak shove): the bear **hangs** on the rim, put back at `edge + 0.2 r` with no velocity, and may climb out. Faster (dash hits, bolts, bombs): it **plunges**: `splash` and `eliminated` in the same tick, no climb. Walking tops out at 280 (378 with the speed power-up), so walking off always hangs.
- **Climbing out:** while hanging it has 1.4 s to press the button 5 times (each press adds 0.2). It then reappears 45 inside the rim, stunned for 0.3 s. Out of time means eliminated.
- **Placement:** on the ice beats in the water, which beats eliminated (by elimination time).
- **Teams:** `teams: true`, max 4 per team. The simulation knows no teams: friendly fire is on.

**Input** (`stepBear` in `server/FrostShove.ts`):

| control | effect |
|---|---|
| stick (analog) | accelerates the bear: `v += stick * 1300 * dt`, friction `exp(-2.4 dt)`, speed capped at 280 (effects change these). It also sets the facing when longer than 0.1 |
| `a1` press edge | holding a bomb: throws it along the facing. Otherwise, with stamina ≥ 0.5: a dash, 760 px/s along the facing for 0.2 s. In the water: a climb press |
| `a2` | unused |

**Item beam** (all variants, `stepBeam` in `server/FrostShove.ts`, which also runs Thaw Frenzy's melt task; no power-up lies on the ice any more, only Wild Frenzy's bombs do): a dispenser (a robot; Gruff in `thaw-frenzy`) orbits outside the rim, then runs `fly` (1.2 s, to a random spot at least 60 px inside the rim), `aim` (1 s, a ring on the ice), `on` (up to 6 s, a disc of `BEAM_R` = 55 px) and `back` (1 s). The first bear on the ice that walks into the live beam gets one random power-up (unknown beforehand) and the beam ends. The next beam comes `itemEvery` s later (default 15, the original's robot). The pool depends on the variant (`beamItems` Frost Classic, `badItemsOnly` Thaw Frenzy, otherwise all six). Events `ext:beam` (goes live) and `pickup`.

**Lightning and Weight** (a bomb-tag style carry; given by the item beam of every variant, `server/FrostShove.ts`; Frost Classic's beam gives only grow, shrink, Lightning and Weight, the other variants mix them with all the timed power-ups): a bear carries at most one, kept apart from the timed effects (`carry`, `carryT`). The countdown is `CARRY_TIME` = 10 s.
- Weight: when it ends the holder is eliminated. Lightning: every other bear on the ice is stunned `LIGHTNING_STUN` = 6 s.
- A touch passes it to the other bear (not invulnerable or dismounted) with the countdown running; the receiver cannot pass it back for `PASS_COOLDOWN` = 0.5 s.
- Falling into the water drops it. Only one exists at a time (while one is held the beam draws a timed power-up instead). A bear that already carries one gets a timed power-up too, so the beam is never wasted.
- Thaw Frenzy offers Weight but never Lightning. Frost Classic offers grow, shrink and these two; while one is held the beam gives grow or shrink instead.

**Wall** (`frost-classic` only, `wall` in `server/config.ts`): 16 ice slices on the rim, one per sector, riding the shrinking rim. The snapshot's `wall` is the bitmask of the slices still standing. A bear whose body would pass the inner face of an intact slice (`edge - WALL_INNER - r`, the client draws the slice from -14 to +12 around the rim) is stopped and bounces (`WALL_BOUNCE`). If its outward speed is above `WALL_BREAK_SPEED` (450: a dash, or a bear flung by one) the slice breaks for good (`crack` event) and the bear carries on with 60% of its speed, then falls under the ledge rule. No host option.

**Collisions:** mass-weighted and elastic (restitution 1.1). A dashing bear adds `300 × power × 2m/(m+m')` and a 0.2 s stun to the bear it hits.

**Variants** (flags in `server/config.ts`, baseline `frost-classic`). Ids are stable (stats, ladders); only names changed.

| variant | adds |
|---|---|
| `frost-classic` | the wall of ice slices; the beam gives only the original's items: grow (`giant`), shrink, Lightning, Weight (`beamItems`) |
| `frost-frenzy` | energy bolts. A line warns for 1 s, then for 0.35 s flings bears on it sideways at 620 px/s, stunned 0.7 s |
| `tip-tumble` | the floe tips towards the bears' centre of mass and pushes everyone that way (`tiltStrength` at full tilt). Every `walrusEvery` s (+/- `walrusVariance`, never under 5 s; the first at half the interval) a fish jumps onto the ice 70 px inside the edge at a random angle (1.6 s), the walrus comes in from the same side (1.4 s), eats (2 s) and leaves (1.2 s). Its weight adds up to 0.8 to the tilt, clamped to 1 with the bears'. It touches nobody. Snapshot `walrus`, event `ext:walrus` |
| `thaw-frenzy` | melt events: every `meltEvery` s (+/- `meltVariance`, never under 2 s, the first at half the interval) Gruff (the dispenser) flies to a random sector's rim (1.2 s), hovers there for 1.5 s breathing a heat ray while the rim glows and cracks (`melts` in the snapshot, from the start of the flight, `beam.ph` = `melt`), then the sector and half as much of its two neighbours melt back by `meltDepth` px for good (floor `MIN_RADIUS`) and he flies back. He does one task at a time: a due melt waits while he is busy with the beam and vice versa. His beam only gives bad power-ups (shrink, freeze, Weight) |
| `wild-frenzy` | bomb pick-ups. The button throws a bomb (560 px/s, 0.9 s fuse, 80 px blast). The first hit dismounts you, the second puts you out |

**Host options:** `timeLimit`, `staminaRegen`, `itemEvery`, `invulnTime`, plus one per variant: `boltEvery`, `tiltStrength`, `walrusEvery`, `walrusVariance`, `meltEvery`, `meltVariance`, `meltDepth`, `bombEvery`. Every interval has a `<name>Variance` (+- s via `nextIn`): `itemVariance`, `boltVariance` (default 0.75 = the old 0.7-1.3x spread), `bombVariance`; `walrusVariance` and `meltVariance` were `*Jitter` (old ids still load, see `OPTION_ALIASES` in `core/shared/catalog.ts`). `maxBolts` caps the bolts falling at once.

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame(playableId, options, rng)` picks the variant from `POLAR_VARIANTS` and builds `FrostShove` (`server/create.ts`, `applyOptions`). `ai` is the bot (`bot/index.ts`). There is no greedy `bot` export, so `npm run balance` uses its generic bot.
- **Snapshot** (`shared/types.ts`, kind `ext:frost-shove`): positions, facing, stamina, radius, effect, carried item and its countdown (`carry`, `carryl`), seconds stunned (`stun`, cosmetic: stars over the bear), climb progress and time left to climb (`fall`, `drown`; `drown` is cosmetic, it sinks the bear on the client), bomb, sectors (already clipped to the shrinking radius), tilt, items (bombs only), the item dispenser and its beam (`beam`: who, phase, where it hovers, the spot), the melt in progress (`melts`, at most one), bolts, flying bombs. It carries no velocities and has no private state.
- **Events:** `splash` (fell in), `eliminated`, `dash` (a dash or a throw), `bump`, `hit` (bolt), `boom` (bomb, `id` = thrower), `bolt`, `pickup`, `spawn`, `catch` (Lightning/Weight passed on), `zap` (Lightning went off), `crack` (a wall slice broke). `ext:beam` (the item beam goes live), `ext:melt` (a bite melted out of the rim), `ext:walrus` (the walrus climbs onto the floe), `ext:weight` (Weight is about to eliminate its holder, sent just before `eliminated`; cosmetic).
- **Catalog and i18n:** `game.json` holds the catalog and options, with the translations in `locales` (`es`, `fr`, `de`, `pt`, `it`). Client text goes through `tr()`. Game and variant names are never translated.
- **Client:** `client/FrostShoveRenderer.ts` (drawing), `client/effects.ts` (the "cling and heave" animation of a bear hanging on the edge is drawn in `drawHang` of the renderer, with presses read from rises of `fall`; timed effects pushed by `event()` in `client/index.ts`: the Lightning shockwave and bolts, the falling Weight, the pass streak; all scaled by `ctx.motion()`) and `client/track.ts`.
- **Checks:** `src/games/packs.test.ts`, `render.test.ts`, `npm run gamepack -- validate src/games/frost-shove`.
- **Imports:** the pack imports only types and `core/shared/kit` from the core.

## The bot (`bot/`)

**One decision:** `index.ts` → `WorldModel.update` (`world.ts`) → `SumoPolicy.decide` (`policy/sumo.ts`) → the variant adapter's `refine` → input.

- **Perception** (`world.ts`):
  - velocities from `kit/track` (reset when a bear climbs out, since it jumps to the rim);
  - `wet` (in the water even before the climb starts: `fall` is still 0 then, but the bear is past the edge);
  - rivals without teammates (`AiContext.allies`);
  - the ice about 1 s ahead (the shrink, and the bites about to melt out of the rim);
  - bolts as lines with the time until they fire, flying bombs with velocity.
- **Prediction** (`physics.ts`): a copy of the movement step and friction-only coasting. The constants are **imported from `server/FrostShove.ts`** (exported there), never copied.
- **Policy `sumo`:**
  - Simulates 16 stick directions plus "let go" for `lookahead` s and scores each:
    - ice left under the bear (`edgeMargin`);
    - being inside a rival's dash reach with the edge behind (`dodge`);
    - bolt bands, also those firing after the horizon;
    - bombs;
    - the item beam, while it can be walked into: an unknown power-up, so a small pull (`-15 * items`), or a push away in Thaw Frenzy where the beam only gives bad ones (`+25`);
    - getting to the spot behind its target, between it and its nearest edge (`aggro`).
  - **Dash:**
    - into a rival whose push direction points over the edge (`dashAlign`) and that is in reach (`dashRange`), when a miss would not take the bot out itself;
    - or a **rescue** dash towards the centre when it is sliding off.
  - **Camping** (`camp`): waits where a rival in the water will climb back, since it is stunned on the rim.
  - **Climbing:** mashes at `mash` presses per second, after `reactionMs`.
- **Policy `greedy`:** walks at the nearest rival and dashes when close. It is the A/B baseline.

Variant adapters (`bot/variants/`; an unknown variant uses `frostClassic`):

| adapter | `Physics` (what the snapshot lacks) | `refine` |
|---|---|---|
| `frostClassic` | none | none |
| `frostFrenzy` | `bolts: true` (read the bolts) | none |
| `tipTumble` | `tiltStrength` (default from `server/config.ts`) | none |
| `thawFrenzy` | `meltDepth`, `badBeam` (lowers the predicted edge at once under every warned bite; keeps out of the beam) | none |
| `wildFrenzy` | `bombs: true` | throws a held bomb at a rival in range, with lead (`bombLead`); never dashes while holding one (the button would throw) |

**Levels** (`levels.ts`, numbers there; full strength = `params.ts`). From easy to semigod, these improve:
- `reactionMs`, `lapse`, `speed`, `noise`;
- the edge margin and look-ahead;
- dash discipline (`dashAlign`, `dashRange`);
- `dodge`, `items`, `aggro`;
- `mash` (easy mashes 5.5 per second, which with its reaction time drowns sometimes);
- `camp` (off up to normal);
- `bombLead`.

Incident causes (`incidents.ts`; one per fall into the water) and their knobs:

| cause | meaning | knobs |
|---|---|---|
| `pushed` | a rival dashed close by just before | `dodge`, `edgeMargin`, `lookahead` |
| `bumped` | a plain collision | `edgeMargin`, `aggro` (it stands too close) |
| `dash-overshoot` | its own dash took it out | the miss check in `considerDash`, `dashRange` |
| `bolt` | Frost Frenzy bolt | bolt costs in `policy/sumo.ts`, `reactionMs` |
| `bomb` | Wild Frenzy blast | `dodge`, the flying-bomb cost |
| `edge-drift` | nothing touched it (walked off, or the ice went) | `edgeMargin`, `lookahead`, the shrink/melt in `world.ts` |

The `drowned` metric counts failed climbs (`mash`, `reactionMs`).

**Commands:**
- Tests: `npx vitest run src/games/frost-shove`.
- Headless A/B: `playRound(variant, seats, opts)` in `bot/sim.ts`, for example `variantAware` 1 vs 0 with seats swapped and 30+ rounds.
- Ladders: `bot/scenarios/ladder-<variant>.json`, for example `npm run bot:arena -- bot/scenarios/ladder-frost-frenzy.json --offline`, then `npm run bot:analyze`.

## Considerations

- **Ties:** at hard and above the bots always climb back out, so rounds between them often end tied on the ice. Judge those levels by falls and pushes-out per round (the `frost-shove: metrics per round` table), not only by wins.
- **Calibration** (2026-10): easy's `mash` is the knife edge. At 5 it drowned and normal beat it every round; at 6 nobody drowned and easy ≈ normal; 5.5 gives 61–65%. Wild Frenzy stays flat (two bomb hits are mostly luck): judge it by pushes-out.
- **Measured** (seats swapped):
  - Variant awareness never loses. In Frost Frenzy, looking at bolts that fire after the horizon cut bolt falls from 53 to 19 (hard).
  - Camping neither wins nor loses (kept).
  - Mashing without reaction time made easy unbeatable in the water, so the reaction time applies.
- **Cost:** about 0.1 ms per decision on a PC (the most expensive AI in the repo, at about 0.5 ms p99). Do not raise the candidate count or the look-ahead step without measuring on `LOW_POWER`.
- **Teams:** teammates are left out of the targets, and a dash is skipped when a teammate stands in the way. Collisions still push teammates.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| `WALRUS_*`, `walrusEvery`/`walrusVariance`, the walrus' share of the tilt | none: the bot sees it only through the snapshot's `tilt` (`world.ts`, times `tiltStrength`) |
| `CARRY_TIME`, `LIGHTNING_STUN`, `PASS_COOLDOWN`, the pass rule in `passCarry` | `policy/sumo.ts` (`carryTarget`, the keep-clear cost, no dash while holding Lightning), level knob `carry` |
| movement and dash constants, friction, stamina cost (`server/FrostShove.ts`, exported) | `bot/physics.ts` (`step`, `coast`, `DASH_REACH`, `KNOCK`) |
| `LEDGE_SPEED` and the hang/plunge split | `physics.ts` (re-exported), the rescue and miss checks in `policy/sumo.ts` (the rescue dash fires on any predicted slide off the ice, even a slow one that would only hang: it is deliberately conservative and does not use `LEDGE_SPEED`), `index.ts` (a plunge counts as a fall, not as drowned) |
| the wall (`WALL_*`, `wall` mask, `stepWall`) | `physics.ts` (`wallUp`, `WALL_COST`, `rayToEdge`), `world.ts` (`wall`), `variants/frostClassic.ts` (`wall: true`), fall/dodge/dash costs in `policy/sumo.ts` |
| fall rule and edge (`polarEdge`, 0.35 r overhang), shrink schedule | `physics.ts` (`margin`, `globalRadius`), `world.ts` (`wet`, sectors ahead) |
| climbing (time, presses) | `index.ts` (mash), `params.ts` `mash` |
| collision and charge-hit push | `physics.ts` `KNOCK`, dash scoring in `policy/sumo.ts` |
| items and effects (`GOOD`/`BAD`, `moveOf`) | `physics.ts` `moveOf`, item costs in `policy/sumo.ts` |
| variant flags and defaults (`server/config.ts`) | `bot/variants/*` and `variants/index.ts` |
| snapshot fields (`shared/types.ts`) | `world.ts` |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above. Constants are imported from the server, so a renamed or removed one fails the typecheck.
3. New variant: add an adapter in `bot/variants/`, its line in `variants/index.ts`, and `bot/scenarios/ladder-<variant>.json`.
4. New or changed input: update `index.ts` (button timing, `EdgeButton`) and the rules-contract test.
5. Run `npx vitest run src/games/frost-shove` (the rules-contract test checks the variant list and the dash/climb inputs) and `npm run gamepack -- validate src/games/frost-shove`.
6. Run an offline ladder and `/bot-tune` if the levels moved.
7. Update this file in the same change.

## Bot sync (2026-10-26)
- The melt prediction floors a sector at `MIN_RADIUS` like `melt()`; the snapshot's `stun` is read (`WBear.stun`): a stunned bot sends no dash/throw (the server ignores it).
- Wild Frenzy: the bomb is not thrown at a rival under hit protection (`inv`), nor at one standing within the blast of a teammate; the Lightning/Weight pass skips a `dismounted` rival (the server refuses it).
- Known limits: `tiltStrength` and `meltDepth` host options are read from the variant defaults (the snapshot does not carry them); stunned rivals are not treated as free targets; bomb `hits` are not read.
