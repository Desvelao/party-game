# Sprint Smash: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs). This file covers what is specific to this pack.

## The game

Hovercrafts race around a ring track (centre 500,500, between radius 260 and 400; the crafts' centres stay within 272 to 388). Laps run **towards increasing angle** (clockwise on screen).

- **Finishing:** `laps` (10) laps finish. The round ends at `timeLimit`, when nobody is racing, or 1.5 s after the first finisher.
- **Placement:** finishers by time, then everyone else by progress.
- **No elimination:** hazards knock you back, stun you and slow you down.
- **Teams:** `teams: true`, max 4 per team. There is no team logic.

**Input** (`stepPlayer` in `server/SprintSmash.ts`):

| control | effect |
|---|---|
| stick | the heading to turn towards (3.5 rad/s), when longer than 0.2. The craft always moves forward |
| `a1` held | throttle while energy lasts (cruise 170 → 270; a fruit boosts to 380 for 1.2 s). Energy drains at `energyDrain`/s and refills at 0.25/s when not held. **Dot Sprint (`berryBar`)**: no passive speed; holding `a1` burns the berry bar (only berries fill it, +0.5 each) at 380 u/s |
| `a1` press edge | the old variants only (none now): use the held item / jump |
| `a2` press edge | every variant (`item2`): use the held item (Dot and Ember missile, `action2` `fire`; Toxic force field, `charge`) or, in Splash Sprint with no item, **jump** (`action2` `jump`; 0.6 s in the air, then a 0.5 s cooldown); `a1` is only the throttle |

**Other rules:**
- **Walls:** scraping a wall costs 3% of the speed **every tick**. **Dot Sprint (`edgeWalls`)**: only the outer edge between 10 and 2 o'clock (`DASH_WALL_FROM`..`DASH_WALL_TO` in `shared/geometry.ts`, atan2 -150..-30 deg) is a wall. The **inner edge is a wall everywhere**. On the outer edge only Dot Sprint keeps a wall, on the top arc (`outerArc`); Toxic Sprint's outer edge is open all round. Elsewhere a craft whose centre passes radius 400 **falls** (into the void in Dot Sprint, the toxic liquid in Toxic Sprint): frozen for `fallPenalty` (+- `fallPenaltyVariance`), then put back on the last safe spot (20 u inside the edges) heading along the track, with hit protection. (The client draws Dot Sprint as a rooftop over a night-city void: hazard-striped walls, drifting clouds, shrinking fall.) **Hit slowdown (`hitSlow`, Dot Sprint, default 3 s)**: a protected hit (missile, star, bump) leaves the craft crawling at 0.35x speed for `hitSlow` (+- `hitSlowVariance`) s on top of the stun; the snapshot carries `slow`. The bot does not model it (it already dodges missiles; its levels were not re-tuned for the harder penalty). A fallen craft is out of bumps, pick-ups and missile hits; the snapshot carries `fall`.
- **Bumps:** an accelerating craft shoves the one it bumps (260, 0.25 s stun).
- **Missiles:** fly along the ring at the radius they were fired at (520 px/s, 2.5 s). **Dot Sprint (`straightMissiles`)**: they fly straight along the craft's heading, bounce on the top wall arc and on the inner wall (and can then hit their owner) and vanish when they leave the track elsewhere; the snapshot carries `vx`/`vy`.
- **Star:** a shock within 110.

**Variants** (flags in `server/config.ts`):

| variant | adds |
|---|---|
| `dot-sprint` | missile pick-ups, open track edges with a wall only at the top, falling, the berry bar and straight bouncing missiles on `a2` (flags `edgeWalls`, `berryBar`, `straightMissiles`). The other variants keep the closed ring, passive gauge, ring missiles and `a1` fire. `variantAware: 0` still races them with Dot Sprint's adapter |
| `toxic-sprint` | 8 barrels at random track points (a barrel that exploded returns after 5 s somewhere else, away from crafts), open outer edge with falling (`edgeWalls` without `outerArc`; the inner edge is a wall), the slime monster's blobs, force field (star) pick-ups used on `a2`, and the berry bar (`berryBar`, `item2`): no passive speed, berries load the bar. The client draws toxic green liquid outside and inside the ring, rust-brown barrels with a trefoil, and an icon above any craft holding an item |
| `ember-sprint` | the Dot Sprint kit (berry bar, straight missiles on `a2`, `item2`, `hitSlow` 3 s) over an open outer edge (`edgeWalls` without `outerArc`: you fall into the lava; the inner edge is a wall) and the volcano: each eruption (warn 1 s, then 4 lava **balls** 0.25 s apart) throws balls from the centre at random racing craft (predicted position, +-0.3 rad), 300 u/s straight; they fly over the infield wall harmlessly and hurt (knock 330, stun 0.3, hit slowdown) only on the track band; the snapshot carries `balls` (with velocity). The bot predicts them as straight lines. Ember's adapter is Dot Sprint's (it aims the missile). No variant uses ring missiles any more (`straightMissiles` false) but the code and the racer's ring-missile logic stay |
| `splash-sprint` | the Dot Sprint kit (berry bar, `item2`, open edge: you fall into the sea; inner wall; `hitSlow` 3 s) and the centre **hub**: 6 ports on a circle, tubes leave them across the track (`HUB_PORTS`). A hub event (`rodEvery` +- `rodVariance`, via `nextIn`) sends the whole set (40%) or one random tube; a tube ramps out 1 s, holds 3 s, retracts 1 s. With chance `rodBurst` % an event starts a sequence of 3-5 events whose interval is x0.25 (min 1.2 s). The hub turns **against the lap direction** at `rodSpeed` (default 0.3 rad/s, so a set's tubes reach a craft about 1.3 s apart: just enough to chain jumps) only while a tube is out; the jump on `a2` |

**Splash Sprint tubes** (rods fixed in 2026-10, hub rework after): a tube passes through a grounded craft and knocks it **in the way the tube is moving** (tangent, against the lap, 300; it used to be radial, which would now throw the craft over the open outer edge) and slows it for 0.8 s plus `hitSlow`, with hit protection stopping a second hit. Before the fix the rod pushed the craft out of the bar every tick and carried it along at the rod's speed (faster than any craft, and in the racing direction), so taking hits beat jumping. `SprintSmash.test.ts` keeps that from coming back.

**Host options:** `laps`, `timeLimit`, `fruitEvery` (default 5 s), `fruitMax` (4 on the track at once), `energyDrain`, `invulnTime`, plus `fallPenalty` and `hitSlow` (Dot Sprint), `missileEvery` (6 s) with `missileMax` (3), `slimeEvery`, `starEvery`, `eruptEvery` or `rodSpeed` by variant. Each spawn interval has a `<name>Variance` (+- s via `nextIn`): `fruitVariance`, `missileVariance`, `eruptVariance`, `slimeVariance`, `starVariance`, `fallPenaltyVariance`, `hitSlowVariance`.

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame` (`DASH_VARIANTS`, `server/create.ts`) and `ai`. There is no greedy `bot` export.
- **Snapshot** (kind `ext:sprint-smash`): players (position, heading `f`, laps `p`, energy `e`, item, `air`, `stun`, `boost`, `inv`, `fin`), `laps`, pick-ups, missiles (position, angle), `barrels`, `slime`, `blobs`, `volcano`, `balls`, `rods` (`a`, `tubes`: six extensions 0..1; tube k points at `a + k` x 60 deg). It carries no speeds and no missile owner.
- **Events:** `hit` (missile, lava, blob, rod), `boom` (barrel), `bump`, `zap` (star), `rocket`, `pickup`, `bank` (finished), `splash` (landed from a jump), `ext:sprint-smash` (jump).
- **Client and catalog:** `client/DashRenderer.ts`, `client/track.ts`; `game.json` with `locales`.
- **Checks:** `packs.test.ts`, `render.test.ts`, `gamepack validate`.
- **Character:** players are drawn with `ctx.drawCharacter`, using the `blob` model of the `characters` plugin (`"character": "blob"` in `game.json`); the game is skipped when that plugin is not loaded. Looks never reach the snapshot, so the bot is unaffected.

## The bot (`bot/`)

**One decision:** `index.ts` → `WorldModel` (`world.ts`) → `RacerPolicy` (`policy/racer.ts`) → the variant adapter's `refine` (the Splash Sprint jump) → input. The throttle is a hold and the item or jump a press of the same button, so it is released for one decision before a press.

**Perception** (`world.ts`):
- its speed, estimated (the snapshot has none);
- its polar position;
- rivals and teammates;
- missiles not its own (marked after it fires), as angle and radius;
- blobs with velocity.

**Constants:** imported from `server/SprintSmash.ts`; the variant rules come from `DASH_VARIANTS`.

**Policy `racer`:**
- **Lines:** tries a handful of radii (inner, inner+30, middle, middle+30, outer, its preferred line) for `lookahead` s, scoring:
  - radians gained;
  - minus hazards (missiles, lava, barrels, blobs; **not the rods**, which span the whole track and are the jump's job);
  - minus wall scraping;
  - plus pick-ups (fruit when low on energy or boost, items when empty-handed).
- **Preferred line:** the middle blended towards the inner line (`line`), 16 px off the wall, with a slow `noise` wobble.
- **Steering:** at a point ahead on the chosen line, aimed wide by the chord sag so the straight line to it stays on the circle (aiming straight at it cut inside and scraped the wall).
- **Throttle:** held a `throttle` share of the time (always holding is fastest; the gauge refills by itself).
- **Items:**
  - a missile when a rival ahead is on its radius; it moves onto that radius when holding one;
  - a star when a rival is within reach and no teammate is;
  - low `items` fires them off blindly.

**Policy `greedy`:** the middle line, throttle held, items at once.

| adapter | rules | `refine` |
|---|---|---|
| `dot-sprint` (baseline), `toxic-sprint`, `ember-sprint` | from `server/config.ts` | none |
| `splash-sprint` | from `server/config.ts` | jumps when a rod (`jumpRods`) or a missile will reach it within 0.25 s, chance scaled by `dodge` |

**Levels** (`levels.ts`): reaction, lapses, `line`, `noise`, `throttle`, `dodge`, `items`, `lookahead`, `jumpRods` (off for easy).

Incident causes (`incidents.ts`; one per knock) and their knobs:

| cause | meaning | knobs |
|---|---|---|
| `missile` | a rival's missile | `dodge`, `lookahead` |
| `lava` / `blob` / `barrel` | the variant's hazard | `dodge`, `lookahead` |
| `rod` | a Splash Sprint tube | `jumpRods`, `dodge`, `reactionMs` |
| `star` | a rival's shock | none (it cannot be seen coming) |
| `bump` | another craft | `line` (everyone on the inner line meets) |
| `unknown` | nothing near | read the incident |

**Commands:**
- Tests: `npx vitest run src/games/sprint-smash`.
- A/B: `bot/sim.ts` (try `{ laps: 5 }`).
- Ladders: `bot/scenarios/ladder-<variant>.json`. The offline arena rotates seats every round, because the start grid gives an edge.

## Considerations

- **Measured:**
  - Semigod beats greedy 6–0 (Dot Sprint); its edge is the inner line and avoiding hazards.
  - Head to head, semigod and hard are close: strong racers differ mainly in fruit luck.
  - After the rod fix, jumping the rods beats not jumping 30–0 at semigod, and is even at hard (whose reaction time makes its jumps late).
- **Dot Sprint rework** (open edges, berry bar, straight missiles): the racer stays inside `R_LO`..`R_HI` so bots do not fall; headless rounds showed no falls. The ladder was not re-tuned: run `/bot-tune` for `dot-sprint` before relying on the calibration below.
- **Calibration** (2026-10, before that rework): in range for every variant, except Splash Sprint semigod>hard at 98% (hard's reaction time makes its jumps late).
- **Cost:** about 0.1 ms per decision.
- **Toxic barrels** move: the bot reads their positions from every snapshot, so nothing is cached. Bots stay inside the wall band (`R_LO`..`R_HI`) so they do not fall off the open outer edge.
- **Toxic Sprint calibration is open**: with the open outer edge and random barrels, semigod beats easy only ~8 of 12 headless rounds (it was ~11/12 on the closed ring), and bots still fall about once per 3 rounds when a barrel or force field knocks them outward. Run `/bot-tune` on `toxic-sprint` (barrel dodge weight, line choice) before relying on its ladder.
- **Ember Sprint** (berry bar, a2 missile, open lava edge, lava balls): headless semigod beat easy 12/12; bots fell about once in 18 seat-rounds. The ladder was not re-tuned: run `/bot-tune` for `ember-sprint` before relying on its calibration.
- **Splash Sprint hub rework**: semigod beat easy 12/12 and jumpers beat non-jumpers 12/12 in headless rounds (`rodEvery` 6, `rodBurst` 50); semigod never fell, easy bots fell ~2 times per seat-round (the open sea edge; easy steers badly after tube knocks). The adapter uses `rodSpeed` from the variant config, not the host option (as before). Not re-tuned: run `/bot-tune` for `splash-sprint` before relying on its calibration.
- **Known limits:** rivals' bumps are not predicted, and lava from a coming eruption (only the warning is known) is not avoided in advance.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| steering, speeds, throttle and energy, wall clamp and scrape | `policy/racer.ts` (line simulation, `CROSS`, `INNER_LINE`, wall cost), `physics.ts` (`R_LO`/`R_HI`) |
| lap direction and progress | `policy/racer.ts` (progress = increasing angle), the rules-contract test |
| pick-ups, items (missile radius rule, star radius), jump | `policy/racer.ts` `items`, `variants/splashSprint.ts`, `variants/dotSprint.ts` (aims and fires the straight missile; `index.ts` presses `a2`), `index.ts` (press after release) |
| open edges, falling, the berry bar | `policy/racer.ts` (`cost()` wall arc, throttle only with a load, idle while `fall`), `physics.ts` |
| hazards (lava, barrels, blobs, rods, missiles) | the hazard costs in `policy/racer.ts`, `splashSprint.ts`, `world.ts` |
| variant flags (`server/config.ts`) | `bot/variants/index.ts` |
| snapshot fields | `world.ts` |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above.
3. New variant: add its line in `variants/index.ts` and `ladder-<variant>.json`.
4. Input changes: `index.ts` and the rules-contract test (laps run towards increasing angle, and `a1` held accelerates).
5. Run the tests and `gamepack validate`.
6. Run an offline ladder and `/bot-tune`.
7. Update this file.

## Bot sync (2026-10-26)
- Splash Sprint: the jump is not pressed while stunned (the server ignores a2). The hub turn rate is measured from consecutive `rods.a` samples (`World.rodSpeed`, fallback the variant's `rodSpeed`), so the host `rodSpeed` option is followed.
- A missile we fired is ignored until it turns (wall bounce, tracked from `vx`/`vy`); from then on it is dodged like any other, since it can hit its owner.
- `m.jumps` counts a2 presses with `mode: 'jump'`; the tube hit threshold (`ROD_HIT`) and `CRUISE` are imported from the server.
- Known limit: a fall has no incident cause (the server's `splash` event is the same for a landing and a fall). Calibration of dot/toxic/ember/splash is still due (`/bot-tune`).
