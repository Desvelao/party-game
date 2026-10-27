# Tank Wars: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs). This file covers what is specific to this pack.

## The game

Tanks shoot it out in an arena (field 60 to 940, tank radius 22). The last tank alive wins; at `timeLimit` (90 s) survivors rank by hit points, then the fallen by when they fell.

- **Hit points:** everyone starts with `maxHp` (100).
- **Teams:** `teams: true`, max 4 per team. There is no team logic, and no owner check on mines, bombs or the totem: **your own mine hurts you**.

**Input** (`stepPlayer` in `server/TankWars.ts`):

| control | effect |
|---|---|
| stick (free driving) | drives at a fixed 150 px/s (Swamp Fox boats 170) in the stick's direction when it is longer than 0.3. **The tank faces the way it drives**, so aiming means steering. Pushed out of blocks and walls |
| stick (rails) | the dominant axis picks a direction along the corridor rails (x or y in 110, 360, 640, 890). A turn onto the other axis happens only within 14 px of a crossing; otherwise it keeps gliding. No input stops it |
| `a1` press edge | with an item: lob the bomb (lands 260 ahead in 0.6 s) or fire the two rockets. That tick does not fire the cannon |
| `a1` held | the cannon. 0.25 s between shots, at most one shot of your own in flight (two for the fireball cannon, so a bouncing shot delays the next one until it ends), not while the shield is up |
| `a2` press | drop a mine (3 s fuse) |
| `a2` in Swamp Fox | held ≥ 0.35 s: the shield (drains in `shieldTime`). A shorter press drops a wandering contact mine |

**Cannons by seat** (`cannonTypes`; `CANNONS`): balanced 520 px/s and 20 damage; plasma 760 and 14; spiky 340 and 32; fireball 480 and 11 (two shots at once). Rockets fly at 900 px/s for 35 damage.

**Variants** (flags in `server/config.ts`):

| variant | rules |
|---|---|
| `desert-fox` | the block maze on rails; mines blow a fire cross along the corridors (380 px) |
| `metal-fox` | Desert Fox plus metal walls that switch every `wallEvery` s (1 s warning) and bomb pick-ups |
| `jungle-fox` | open field with a solid 200x200 post in the middle (`TANK_TOTEM_POST`: tanks, shots and the bot's nav/flight treat it as a wall; the totem falls from it), radial mines (120), the falling totem (a 300 px bar from the centre, 1.2 s warning, 50 damage), rocket pick-ups |
| `swamp-fox` | boats, the shield, wandering contact mines, no fruit or mine pick-ups. A dropped mine drifts in a random direction at `mineSpeed` (35 px/s), bounces off the field edge and the border bars, never times out, is armed after 0.8 s and then blows (90 px, 45 damage) when any boat, its owner's too, touches it. Cannon shots bounce (see below) |

**Host options:** `timeLimit`, `maxHp`, `mines`, `cannonTypes`, `invulnTime`, `rails` (on for Desert/Metal; turning it on elsewhere gives rails without the maze), `fruitEvery`, `wallEvery`, `bombEvery`, `totemEvery`, `missileEvery`, `shieldTime`. Each interval has a `<name>Variance` (+- s via `nextIn`): `fruitVariance`, `bombVariance`, `missileVariance`, `totemVariance`, `mineEvery`/`mineVariance` (was the fixed 20 s), `wallVariance` (the walls now flip on a stored timer, `wallLeft`, not on `floor(t / wallEvery)`; the snapshot's `walls.warn` is the last second before the flip, so the bot is unaffected). `arenaSize` (Jungle Fox and Swamp Fox only, default 8 of the 11 floor squares of 80 units; 6-11): the field is centred and closed in by four solid bars (`arenaBorder` in `shared/geometry.ts`), the snapshot's `size` lets the client draw it and the bot add the same bars to its solids (`solidsOf`, so nav, shots and flight all respect it). Start spots are pulled in (`spawnAt`), pick-ups and lobbed bombs use `arenaBounds`. The totem bar (300 long) can reach the border at sizes under 8; that is harmless. `shotBounce` (default on, Swamp Fox and Jungle Fox only: the cannon shot, not the rocket, rebounds off solids, the border bars and the field edge instead of dying there; the snapshot's `f` follows each bounce; a bounced shot still never hurts its owner) and `shotLife` (s the shot flies, default 3 here, 5 in Desert/Metal Fox; no variance companion: a per-shot random life is not a timer anyone tunes), `mineSpeed` (Swamp Fox, 10-100 px/s). Bot: it still predicts a shot only up to the first wall (`flight`) and sees a bounced shot's new direction on the next snapshot; a wandering mine is treated as a static contact mine at its current position (the 30 px trigger plus the 8 px margin covers 35 px/s), and the `own-mine` incident label uses the drop point.

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame` (`TANK_VARIANTS`, `server/create.ts`) and `ai`. There is no greedy `bot` (`npm run balance` uses its generic one).
- **Snapshot** (kind `ext:tank-wars`): players (position, facing `f`, hp, cannon, mines, shield, `up`, `inv`, item), `rails`, shots (`f`, kind, cannon `c`: the velocity follows from them), bombs (current position, progress `h`), mines (fuse 1 → 0, or −1 for contact), pick-ups, blasts, `walls` (`raised[]`, `warn`), `totem` (`a`, `warn`, `hit`). It carries no shot owner, cooldowns or glide direction.
- **Shared geometry:** `shared/geometry.ts` (blocks, rails, metal walls, spawns, totem). The client draws the same layout.
- **Events:** `throw` (a cannon shot or a lob), `rocket`, `spawn` (mine), `explode`, `smash` (totem), `hit`, `zap` (blocked by the shield), `heal`, `pickup`, `eliminated`.
- **Client and catalog:** `client/TankRenderer.ts`, `client/track.ts`; `game.json` with `locales`.
- **Checks:** `packs.test.ts`, `render.test.ts`, `gamepack validate`.
- **Character:** players are drawn with `ctx.drawCharacter`, using the `blob` model of the `characters` plugin (`"character": "blob"` in `game.json`); the game is skipped when that plugin is not loaded. Looks never reach the snapshot, so the bot is unaffected.

## The bot (`bot/`)

**One decision:** `index.ts` → `WorldModel` (`world.ts`) → `TacticianPolicy` (`policy/tactician.ts`) → the variant adapter's `refine` → input.
- The arena is seen `reactionMs` late; its own tank is always the newest.
- `prepare()` runs when a snapshot arrives and (re)builds the path grid there, not in `decide()`.

**Perception** (`world.ts`):
- the solids (blocks, and the metal walls; **a wall about to switch counts as raised**);
- rivals and teammates, with estimated velocities;
- shots that are not ours, with velocity from facing and cannon and `tMax` (time until they hit a wall). A new shot is ours when it sits on our facing line at the muzzle;
- mines with their blast time and, in the maze, the fire cross;
- bombs with their landing point (from two samples);
- the glide direction on rails.

**Prediction** (`physics.ts`): a copy of the free and rail movement (`pushOut`, `snapToRail`, `railDirection`), line of sight, the fire cross. Constants are imported from `server/TankWars.ts`.

**Path grid** (`nav.ts`): a 10 px grid of free cells (or rail cells), with a breadth-first distance map from the goal. The masks are cached per layout for the whole process; the goal map is rebuilt when the goal moves 30 px, at most every 250 ms.

**Policy `tactician`:**
- **Candidates:** the 16 stick directions plus stop (the 4 axes plus stop on rails), simulated for 0.6 s.
- **Score:**
  - shots that would hit (`dodge`);
  - mines about to blow, bombs landing, the totem, contact mines (`hazards`);
  - path distance to the goal.
- **Goal:**
  - a fruit when hurt;
  - an item or a mine pick-up;
  - a firing spot near the target: on rails, a spot on the target's rail line in sight of it; free, back along the line at a standoff that shrinks with `aggression`.
- **Aim:** a rival in sight (on rails: on the same rail line), with lead (`lead`), plus `aimNoise`, and no teammate in the line. When steering that way costs at most `0.6 × aggression` more than the best move (the goal charged after `aimStep` steps), it drives that way and holds the cannon.
- **Items:** missiles go off with an aim. A bomb goes when its landing point (along the way it drives) is on a rival.
- **Mines:** dropped when a rival is close behind (`mines`).

**Policy `greedy`:** drives at the nearest rival with the cannon held.

| adapter | `Physics` | `refine` |
|---|---|---|
| `desertFox` (baseline) | `maze: true` | none |
| `metalFox` | `maze: true` | none (walls and bombs come from the snapshot) |
| `jungleFox` | `maze: false` | none |
| `swampFox` | `maze: false, swamp: true` | raises the shield for a shot that will hit later than the 0.35 s hold, holds it at least that long (a shorter hold drops a mine) and does not fire meanwhile |

**Levels** (`levels.ts`): reaction, lapses, `aimNoise`, `lead`, `dodge`, `hazards`, `aggression`, `fireDiscipline`, `items`, `mines`, `shield`.

Incident causes (`incidents.ts`; one per hit taken) and their knobs:

| cause | meaning | knobs |
|---|---|---|
| `shot-undodged` | a shot it had seen for 0.3 s or more | `dodge`, `aimStep`/`aggression` (turning to fire into shots), `reactionMs` |
| `shot-unseen` | a shot it saw too late (close range, fast cannon) | standoff (`aggression`), `reactionMs` |
| `own-mine` | its own mine | `hazards`, `mines` |
| `blast` | a mine or bomb | `hazards` |
| `totem` | the totem fell on it | `hazards` |

**Commands:**
- Tests: `npx vitest run src/games/tank-wars`.
- A/B: `bot/sim.ts` (options `rails`, `cannonTypes`).
- Ladders: `bot/scenarios/ladder-<variant>.json`. The offline arena rotates seats every round, since the seat picks the spawn **and the cannon**.

## Considerations

- **Measured:**
  - `aimStep` 1 made every pair a coin flip decided by the seat, with point-blank trades in 6 to 8 s rounds; 3 or more kept skill in it (hard beat normal 9–3 and 12–0). 3 is the default.
  - Driving at the rival's own position on rails ended rounds in 10 s; the rail standoff spot fixed it.
  - Variant awareness and the Swamp Fox shield did not measurably win or lose.
- **Calibration** (2026-10, `bot/reports/tuning-log.md`): in duels the levels separate (hard beats normal 17–7, normal beats easy 18–5). In 4-tank rooms they barely do: the aggressive levels fight each other while a passive easy hangs back. Judge the 4-seat ladder by average place, not pairwise wins. The fix is in the policy (third-party awareness: prefer a rival already busy with someone else, stay out of crossfire) and has not been done.
- **Cost:** about 0.02 ms per decision on average, 0.2 ms p99, and about 3 ms for the first decision (grid and JIT). `gamepack validate` allows 5 ms per decision, so keep heavy setup in `prepare()`.
- **Teams:** shots and items are held when a teammate is in the line of fire. Mines, bombs and the totem hit everyone.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| movement (speeds, rails, `railDirection`, `pushOut`, clamps) | `bot/physics.ts` `step` (a copy: keep it in step), `nav.ts` (free cells) |
| cannons, shots, rockets (`CANNONS`, speeds, life, hit radius) | `world.ts` (shot velocity, own-shot test), `policy/tactician.ts` (lead, dodge) |
| mines, bombs, totem, walls (shapes, fuses, damage) | `physics.ts` (`fireRays`, `inFire`), `world.ts`, the hazard costs in `policy/tactician.ts` |
| arena layout (`shared/geometry.ts`) | `physics.ts` `solidsOf`, `nav.ts` |
| buttons (item press, cannon hold, mine press, shield hold) | `index.ts` (`EdgeButton`s), `variants/swampFox.ts` |
| variant flags | `bot/variants/*` |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above. The movement copy in `physics.ts` is the one place that is a copy, so the rules-contract test checks that facing follows driving and the cannon fires along it.
3. New variant: add an adapter in `bot/variants/` and `ladder-<variant>.json`.
4. Input changes: `index.ts` and the rules-contract test.
5. Run the tests and `gamepack validate` (watch the 5 ms limit).
6. Run an offline ladder and `/bot-tune`.
7. Update this file.

## Bot sync (2026-10-26)
- Reviewed against the current server: no change needed. `ROCKET_DMG` is exported and imported by `world.ts`. Not modelled: the bot still fires at Swamp Fox rivals with a raised shield (`up`).
