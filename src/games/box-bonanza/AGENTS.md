# Box Bonanza: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs). This file covers what is specific to this pack.

## The game

A brawl in a square arena (70 to 930): pick up crates, throw and kick them at each other.

- **Winning:** the last one standing wins; at `timeLimit` (90 s) survivors rank by hit points, then the knocked-out by when they went.
- **Out:** at 0 hit points (`maxHp` 10), by falling into a hole (Space Bonanza), or when the weight's countdown runs out on you.
- **Teams:** `teams: true`, max 4 per team. There is no team logic: kicks, blasts and crates hurt teammates too.

**Input** (`stepPlayer` in `server/BoxBonanza.ts`; presses are latched, so a quick tap never gets lost):

| control | effect |
|---|---|
| stick | velocity follows `stick × top` through a grip (12/s; 2.2 on ice). Top speed 260 (×1.5 boots, ×0.4 Z, ×0.75 carrying). It also sets the facing |
| `a1` press | in order: fire a weapon (if it has charges); else throw the held crate along the facing (640 px/s); else pick up the crate the snapshot's `target` names (in front first, else the nearest in reach). Picking up or throwing a TNT lights it |
| `a2` press | the kick (cooldown `kickCooldown`): every player within `kickRange` takes 1 damage and a knock-back; every crate in reach (not nitro) flies straight away from you at 520 and becomes yours |

**Crates:**
- A thrown or kicked crate hurts players other than its owner while faster than 90 px/s (block 2, locked 1); friction 1.4/s.
- TNT blows up `tntFuse` s after it is lit, or when it hits a rival (`blastRadius`, `tntDamage`).
- Nitro blows up when touched or hit by a flying crate.
- With `solidCrates`, resting crates block players.

**Variants** (flags in `server/config.ts`):

| variant | rules |
|---|---|
| `jungle-bonanza` | the baseline: nitro, solid crates |
| `space-bonanza` | blasts leave holes in the floor (falling in is out); power-ups (mask, boots, Z, the weight) |
| `snow-bonanza` | ice (grip 2.2), the penguin (wakes when touched, spins out from the centre and flings what it meets), power-ups |
| `drain-bonanza` | no nitro; weak locked crates; ? crate sets (one hides a weapon: ring, missile or homing orb; the rest heal) |

**Host options:** `timeLimit`, `maxHp`, `crateEvery`, `tntFuse`, `tntDamage`, `blastRadius`, `pickupRange`, `pickupCooldown`, `kickRange`, `kickCooldown`, `solidCrates`, `invulnTime`, plus `powerupEvery`, `weightTime`, `penguinTime` or `boxEvery` by variant. Every timed interval has a `<name>Variance` (+- s via `nextIn`): `crateVariance`, `berryEvery`/`berryVariance` (was a fixed 7 s), `powerupVariance`, `boxVariance`. The bot sees only the snapshot, so it is not affected.

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame` (`CRATE_VARIANTS`, `server/create.ts`) and `ai`. There is no greedy `bot` export.
- **Snapshot** (kind `ext:box-bonanza`): players (position, facing, hp, `hold`, `target` (the crate a pick-up would take), `holdFuse`, effect timers, weight, weapon and charges), crates (kind, `fuse`, `moving`; held crates are left out), pick-ups (a ? crate's weapon is hidden), shots, `penguin`, `holes`, `tntFuse`, `blastRadius`, `weightTime`. It carries no velocities, cooldowns or crate owner.
- **Events:** `throw`, `pickup`, `kick`, `hit`, `crack` (a mask took a hit, or a crate broke), `explode` (with `id` for a ring or weight death), `rocket` / `zap` (weapons), `bump` (penguin fling), `heal`, `eliminated`, `spawn`.
- **Client and catalog:** `client/CrateRenderer.ts`, `client/track.ts`; `game.json` with `locales`.
- **Checks:** `packs.test.ts`, `render.test.ts`, `gamepack validate`.
- **Character:** players are drawn with `ctx.drawCharacter`, using the `blob` model of the `characters` plugin (`"character": "blob"` in `game.json`); the game is skipped when that plugin is not loaded. Looks never reach the snapshot, so the bot is unaffected.

## The bot (`bot/`)

**One decision:** `index.ts` → `WorldModel` (`world.ts`) → `BrawlerPolicy` (`policy/brawler.ts`) → input. Both buttons are presses; a throw points the stick along its aim for the press.

**Perception** (`world.ts`):
- players and crates with estimated velocities;
- **crates it sent flying** (moving within 0.4 s of its own throw or kick, near it). The server's crate owner is not in the snapshot, and a crate does not hurt its thrower;
- lit TNT carried by others;
- enemy shots (its own are marked after it fires);
- the penguin.

**Constants:** imported from `server/BoxBonanza.ts` (speeds, grip, radii, friction, damage, ranges). The variant rules are read from `CRATE_VARIANTS`.

**Policy `brawler`:**
- **Candidates:** 16 stick directions plus stop, simulated for 0.5 s with the grip-based movement against resting crates.
- **Score:**
  - flying crates it did not send, by damage; TNT about to blow (sliding or carried); nitro by touch; shots; the penguin's circle;
  - holes and their edges (a kick or blast throws you far);
  - bad power-ups; a rival carrying the weight (all scaled by `dodge`, `items`);
  - minus good pick-ups reached;
  - plus the distance to the goal.
- **Goal:**
  - a rival to pass the weight to;
  - a heal, ? crate or mask worth the walk;
  - a crate to pick up (near the bot and near the target);
  - a throwing or weapon range from the target.
  - **A held TNT is thrown only from outside its own blast.**
- **Presses:**
  - **pick up** when `target` names a crate that is not about to blow;
  - **throw** with lead (`lead`, `aimNoise`) when the rival is in reach, no teammate is in the line, and (for TNT) the rival stands outside the blast around the bot;
  - a lit TNT about to go off goes the way with the most room;
  - **kick** a rival in reach, or a crate when the rival is behind it (`kick`);
  - **weapons:** ring up close, missiles within about 320, the homing orb up to 650 (`weapons`).

**Policy `greedy`:** grab the nearest crate, throw it at the nearest rival, kick when close.

**Variants** (`bot/variants/index.ts`): each adapter holds the variant's rules (holes, ice, penguin, power-ups, nitro, locked crates, ? crates). `variantAware: 0` plays every variant as Jungle Bonanza (no holes, no ice grip).

**Levels** (`levels.ts`): reaction, lapses, `aimNoise`, `lead`, `dodge`, `aggression`, `kick`, `items`, `weapons`.

Incident causes (`incidents.ts`; one per hit, masked hit or knock-out without a hit) and their knobs:

| cause | meaning | knobs |
|---|---|---|
| `blast` | a TNT or nitro went off by it | `dodge`; the TNT throw distance |
| `kicked` | a rival's kick | `dodge`, `aggression` (standing in reach) |
| `crate-hit` | a crate a rival threw or kicked | `dodge`, `reactionMs` |
| `weapon` | a ring, missile or orb (a rival fired lately) | `dodge`, weapon range |
| `penguin` | flung by the penguin | `dodge` |
| `hole` | knocked out with no hit (Space Bonanza) | the hole-edge cost, `dodge` |
| `weight` | the weight's countdown ran out on it | the pass-the-weight goal |
| `unknown` | nothing seen | read the incident file |
| `*-masked` | the same, absorbed by the mask | |

**Commands:**
- Tests: `npx vitest run src/games/box-bonanza`.
- A/B: `bot/sim.ts`.
- Ladders: `bot/scenarios/ladder-<variant>.json`.

## Considerations

- **Measured:**
  - Throwing a TNT at a rival 50 px away blew up the thrower, and in Space Bonanza three players went into the new holes at once; hence the blast rule.
  - Keeping off hole edges turned Space Bonanza variant awareness into a 14–5 win.
- **Calibration** (2026-10): Jungle and Drain Bonanza separate well. In Snow and Space Bonanza normal beats easy in only 56–59% of rounds: the ice and the holes level the field. A movement change for easy on ice is the next step.
- **Known limits:**
  - Crate ownership is guessed from its own launches; a crate a rival kicked into the bot's own thrown crate is not followed.
  - The penguin's orbit radius is assumed constant over the look-ahead.
- **Cost:** about 0.5 ms p99 per decision on a PC.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| movement (speed, grip, carry, boots, Z, push-out from crates) | `bot/physics.ts` (`moveOf`, `step`) |
| actions (`act` order, `crateInFront`, throw speed, kick range and rules) | `policy/brawler.ts` (`actions`, `throwAim`), `index.ts` buttons |
| crates (friction, damage, TNT/nitro rules, blast radius) | `physics.ts` `slide`, hazard costs in `policy/brawler.ts`, the TNT rule |
| holes, penguin, weight, pick-ups, weapons | `policy/brawler.ts` (`cost`, `pickGoal`), `world.ts` |
| variant flags (`server/config.ts`) | `bot/variants/index.ts` |
| snapshot fields | `world.ts` |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above.
3. New variant: add its line in `variants/index.ts` and `ladder-<variant>.json`.
4. Input changes: `index.ts` and the rules-contract test (the snapshot names the crate a pick-up takes, and `a1` takes it).
5. Run the tests and `gamepack validate`.
6. Run an offline ladder and `/bot-tune`.
7. Update this file.

## Bot sync (2026-10-26)
- The ring is fired inside `RING_RANGE - 10` (it only hurts within `RING_RANGE` of the centres). While armed the bot tries nothing else on a1 (the server fires the weapon first). `PENGUIN_SPIN` is imported from the server.
- Known limits (not in the snapshot): the `kickRange`, `solidCrates` (the bot always treats resting crates as solid), `pickupCooldown` and `tntDamage` options; the penguin's fling (no steering for 0.55 s).
