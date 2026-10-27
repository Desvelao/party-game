# Spring Showdown: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs). This file covers what is specific to this pack.

## The game

Players hop on an n×n grid (`gridSize`, default 8), painting every square they land on. Banking turns painted squares into points and clears them. Most banked points wins, with unbanked squares breaking ties (`score × 10000 + tiles`); leavers are last.

- **Banking:** landing on a crate banks (`scoreBy: 'crates'`); in Spring Rush closing a loop banks instead.
- **Teams:** `teams: true`, max 4 per team. No friendly-fire check: missiles skip only their owner, and teammates paint over each other.

**Input** (`stepPlayer` in `server/SpringShowdown.ts`):

| control | effect |
|---|---|
| stick | the dominant axis sets the facing every tick, even mid-hop or stunned. When not hopping or stunned, a held direction hops one square that way (`hopTime`, ×0.55 with boots). Holding chains hops. The snapshot shows the destination as soon as a hop starts |
| `a1` press edge | use the held item: a missile along the facing (all four ways with `fourWayMissile`, 13 squares/s), or the beam (stuns everyone in the row or column ahead along the facing, any distance; `inBeam`) |
| `a2` | unused |

**Landing, in order:**
1. paint, or self-wipe;
2. arrow (paints lines to the edges);
3. enclosure (`fillEnclosed`, `server/loops.ts` `enclosedTiles`; the wall must be orthogonally connected and closed inside the board: a diagonal-only line or the arena edge does not close, so a wall-to-wall arrow cross fills nothing);
4. the item: a crate banks; boots; a missile or beam into the slot; the padlock locks your squares; a mushroom or TNT stuns.

A stun clears your boots and item. Hit protection follows.

**Variants** (flags in `server/config.ts`):

| variant | rules |
|---|---|
| `spring-painter` | the baseline: crates bank (no variant enables mushrooms for now) |
| `spring-rush` | `scoreBy: 'enclose'` (a closed loop fills and banks everything you own), four-way missiles, the beam, double arrows |
| `spring-madness` | loops fill (no bank); Blast Bot circles the board dropping TNT, firing missiles in from the edge and leaving 4-way arrows. A TNT has a fuse (`tntFuse`, default 3 s, its item `ttl`): at 0 `explode()` wipes the colour (not padlocked) and stuns players within `tntRadius` (1 = 3x3) and emits `boom`. Landing on it first stuns and removes it (no blast). The snapshot carries `f` (fuse left) per TNT and `blast` |
| `spring-lock` | no arrows; landing on your own colour wipes it all unless your padlock is on; a missile hit steals the victim's squares |

**Host options:** `collisions` (game level, on by default: players cannot share a square; the bot avoids occupied squares for its first hop), `timeLimit`, `hopTime`, `gridSize`, `itemEvery`, `stunTime`, `invulnTime`, plus `crateEvery`, `tntEvery` or `padlockTime` by variant. `crateCount` (crates per spawn, 1-6, default 2; board cap max(2, 2 x count)), `itemVariance` / `crateVariance` (+- seconds on the spawn interval, default 0 = fixed) are server-only timing: the bot reads no spawn intervals (it reacts to items in the snapshot), so they need no bot change. `tntVariance` (+- s on the Blast Bot interval) joins `itemVariance` and `crateVariance`; all use the kit's `nextIn`.

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame` (variant from `POGO_VARIANTS`, `server/create.ts`). `bot` is the greedy painter in `server/bot.ts` (`npm run balance`). `ai` is the bot.
- **Snapshot** (kind `ext:spring-showdown`): `tiles` (owner index per square), players (`c,r` destination, `pc,pr` start, `hop` progress, facing, score, tiles, item, boots, lock, `stun`, `inv`), items (`k`, arrow mask `d`), missiles (in square units, `dir`), `boss` (Bomber). It carries no timers or missile owner, and has no private state.
- **Snapshot `beams`:** transient (0.4 s) bolts for the client, only while a beam is on screen; the bot ignores it.
- **Events:** `stun`, `wipe`, `bank`, `fill`, `rocket`, `zap`, `tnt`, `pickup`, `spawn`.
- **Missile sounds:** `client/sounds.ts` (`missileSounds` diffs the missiles of each snapshot: a launch, a Blast Bot launch from the edge, a hit inside the board; played with `ctx.sound`). The boots sound pulses while `boots > 0` (`bootsSound`, played for the local player, else the first boosted one). Client only, so the bot is unaffected.
- **Catalog and i18n:** `game.json` and `locales`; `client/PogoRenderer.ts`, `client/track.ts`.
- **Checks:** `packs.test.ts`, `render.test.ts`, `gamepack validate`.
- **Character:** players are drawn with `ctx.drawCharacter`, using the `blob` model of the `characters` plugin (`"character": "blob"` in `game.json`); the game is skipped when that plugin is not loaded. Looks never reach the snapshot, so the bot is unaffected.

## The bot (`bot/`)

**One decision:** `index.ts` → `WorldModel` (`world.ts`) → `PlannerPolicy` (`policy/planner.ts`) → input.
- The board is seen `reactionMs` late, but **the bot's own position and its own squares come from the newest snapshot**. A late view of its own paint made it land on squares it had just painted, which in Spring Lock wiped everything.
- The plan is made once per hop (or every 200 ms); firing is checked on every decision.

**Perception** (`world.ts`):
- own index, rivals and teammates (`allies` → indexes);
- missiles except its own (marked after it fires);
- lit TNT (`items[].f` fuse left, `blast` radius): `danger()` counts a blast landing while it would stand there;
- the hop time, measured from how fast `hop` grows (it is a host option).

**Constants:** `DX`, `DY`, `DIR_BIT`, `BOOTS_FACTOR`, `MISSILE_SPEED`, `inBeam` come from `server/SpringShowdown.ts`; `enclosedTiles` from `server/loops.ts`. The variant rules are read from `POGO_VARIANTS`.

**Policy `planner`:**
- Searches every path of `depth` hops (no immediate back-steps) on a copy of the board it paints as it goes. Each hop is scored on:
  - **paint:** an empty square +1; a rival's +1.3, more for the leader's; a teammate's −0.3;
  - **own colour:** a small cost, or a large one where it wipes (`careful`);
  - **items:** a crate is worth `bank` × the squares it banks; boots, missile/beam, padlock and arrows (counted squares) by `items`; mushroom and TNT are costs;
  - **loops:** in variants with `fillEnclosed`, for the first two hops only and only when the square can close one: squares gained, plus in Spring Rush the bank (a bank under `encloseMin` squares is held back);
  - **danger** while it stands there (`hazards`): missiles crossing its row or column at that time, a lined-up rival holding a missile, a rival holding the beam with you in its facing line.
- **Past the horizon:** distance to the nearest paintable square and to a crate (weighted by what it would bank).
- **Fire:** a missile when a rival (not protected) is lined up, aimed at the square it will be on when the missile arrives, or soon after pick-up for low `aim`. The beam when a rival is ahead in the facing line. It fires mid-hop, then turns the stick back before the landing picks the next hop.

**Policy `greedy`:** wraps `server/bot.ts`.

**Variants** (`bot/variants/index.ts`): each adapter holds the variant's `rules` from `server/config.ts` and item bonuses (`spring-madness`: arrows; `spring-lock`: padlock and missile). `variantAware: 0` plays every variant as Spring Painter.

**Levels** (`levels.ts`): reaction, lapses, `depth` (1 to 4), value `noise`, `bank`, `aim`, `items`, `hazards`, `enclose`, `careful`.

Incident causes (`incidents.ts`) and their knobs:

| cause | meaning | knobs |
|---|---|---|
| `missile` | a rival's missile | `hazards`, `danger()` in `policy/planner.ts` |
| `bomber-missile` | a missile nobody fired (Blast Bot) | `hazards`, `reactionMs` (the Bomber's missiles appear suddenly) |
| `beam` | a rival's beam | `hazards` |
| `tnt` / `mushroom` | landed on one | `hazards`, item values |
| `blast` | stunned by a TNT explosion (`boom`) | `hazards`, `danger()` TNT term |
| `self-wipe` | landed on its own colour in Spring Lock | `careful`; it should not happen above easy |

**Commands:**
- Tests: `npx vitest run src/games/spring-showdown`.
- A/B: `bot/sim.ts` (try `{ gridSize: 16 }`).
- Ladders: `bot/scenarios/ladder-<variant>.json`.

## Considerations

- **Measured** (seats swapped):
  - semigod beats normal 10–0 (8×8) and 8–2 (16×16); normal beats easy 8–2.
  - Spring Rush loop valuation measured even, 52–48 over 100 rounds against no loop valuation. It does not lose, so it is kept, with `encloseMin` 10; without that it lost 11–29 (many small banks threw away colour).
  - With the own-squares fix, Spring Lock self-wipes fell from about 40 per round (normal) to about 0.
- **Cost:** about 0.2 ms p99 per decision on a PC. `depth` 4 on a 16×16 board is the most expensive case; do not raise `depth` beyond 4.
- **Input:** the vertical stick (`my`) must reach the server; the bots plugin's brain sends it.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| hopping (one square, chained, destination in the snapshot, boots factor, `collisions`: a hop onto an occupied square is refused, snapshot `solid`) | `policy/planner.ts` (search from `c,r`, `hop` timing, `occupied` for the first hop), `world.ts` (hop-time learning) |
| landing order, paint, wipe, arrows, items, stun | `policy/planner.ts` `search`, `itemValue` |
| enclosure (`server/loops.ts`), banking | `policy/planner.ts` loop valuation (`mayClose`, `encloseMin`) |
| missiles and beam (speed, range, `tileOf` half-hop rule, steal) | `policy/planner.ts` `danger`, `considerFire` |
| variant flags (`server/config.ts`) | `bot/variants/index.ts` (`rulesOf`, item bonuses) |
| snapshot fields | `world.ts`, `incidents.ts` (event kinds) |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above.
3. New variant: add its line in `variants/index.ts` and `ladder-<variant>.json`.
4. Input changes: `index.ts` (fire press, stick) and the rules-contract test.
5. Run the tests and `gamepack validate`.
6. Run an offline ladder and `/bot-tune`.
7. Update this file.

## Bot sync (2026-10-26)
- Incidents: the server emits `stun` before the `tnt`/`boom`/`zap` that caused it, so `onEvents` records the whole batch before classifying (`tnt`, `blast` and `beam` were previously misread as missile/mushroom).
- Fire: the beam is not used when it would stun a teammate more than a rival; a missile is not fired along a line where another player (ally included) stands nearer; the Spring Lock steal bonus is dropped when the victim's padlock is on.
