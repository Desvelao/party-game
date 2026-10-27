# Balance testing

`npm run balance` plays thousands of seeded minigame rounds with scripted bots, in a few seconds to a few
minutes and with no browser, server or network. Use it to see whether a variant's default options are
balanced: rounds that end too fast, a spawn slot that wins too often, a variant where standing still wins,
or an option that changes everything.

It is a developer tool: it needs the source checkout (`npm install`, Node 18+, 22 recommended) and is not
part of the production image. It does not change any game setting; you apply what you learn yourself
(see [Applying what you find](#applying-what-you-find)).

## Quick start

1. Play a sweep and save the results:

   ```
   npm run balance -- --variant smashball,frost-classic --players 2,4 --seeds 20 --out balance.jsonl
   ```

   The report prints when the run ends. Leave out `--variant` to play all 27 variants (about 45 s for
   30 seeds at 2 and 4 players).
2. Print the report of a saved file again at any time, without playing:

   ```
   npm run balance -- --report balance.jsonl
   ```
3. Add `--csv balance.csv` to `--report` to get the rows as a spreadsheet file.
4. `npm run balance -- --list` shows the variant ids; `npm run balance -- --help` shows every flag.

Runs are reproducible: the same flags give the same file, byte for byte. Seeds are `1..N`.

## Flags

| Flag | Default | What it does |
|---|---|---|
| `--variant ID[,ID...]` | all variants | Variants to play (ids from `--list`). |
| `--players N[,N...]` | `2,4` | Player counts. A variant skips counts above its own player limit. |
| `--seeds N` | `10` | Rounds per combination. More seeds means fewer false alarms; use 30 or more before trusting a flag. |
| `--scenarios S[,S...]` | `random,greedy,skill,idle` | Which bot line-ups to play (below). |
| `--sweep none\|options` | `none` | `options` also plays each option at its minimum and maximum (every other choice for choice options, the opposite for on/off options), one option at a time. |
| `--out FILE` | `balance.jsonl` | Where to write one JSON line per player per round. |
| `--no-report` | off | Do not print the report after playing. |
| `--report FILE` | | Only print the report of an earlier `--out` file. |
| `--csv FILE` | | With `--report`: also write the rows as CSV. |

The number of rounds is variants × option points × player counts × scenarios × seeds, so `--sweep options`
with many seeds takes a while; narrow `--variant` first.

## The bots

Bots decide ten times a second and hold their input in between.

| Bot | Behaviour |
|---|---|
| random | Picks a random direction (and sometimes stands still), taps the buttons at random. |
| idle | Does nothing. |
| greedy | A simple rule per family: Ballistix slides under the nearest ball, Pogo hops to the nearest tile that is not yours, Crazy Logs hops across when a log is below, everything else chases the nearest opponent and attacks when close. |

The greedy bot is deliberately crude. It tells you whether "go and attack" beats random play, not how good a
person can get, and in some games (Box Bonanza, the Sprint Smash races) it plays worse than random. Treat a
skill-gap flag as a hint to look, not as proof.

Scenarios decide who plays in each round:

| Scenario | Line-up | Answers |
|---|---|---|
| `random` | everybody random | Is any spawn slot favoured? |
| `greedy` | everybody greedy | The same, with competent play. |
| `skill` | one greedy bot among random ones | Does playing well pay off? |
| `idle` | one idle bot among random ones | Can you win by standing still? |

In `skill` and `idle` the special bot's slot rotates with the seed, so no slot is favoured.

## Reading the report

Only rounds played with the default options feed the first four tables.

- **Duration**: mean, 10th and 90th percentile length of a round in seconds, the time limit, the share of
  rounds that ran to the limit (`at limit`) and the share that never finished (`stuck`). A round that
  ends in a few seconds feels like nothing happened; one that always runs to the limit has no decisive end.
  `stuck` should be 0%: a stuck round means the game did not end, which is a bug.
- **Spawn slot win share**: how often each slot (player 1, 2, ...) wins when everybody plays randomly. Fair is
  100/N %. Shares of 3 to 6 players are noisy until you have many seeds.
- **Skill gap**: how much more than its fair share a greedy bot wins among random ones (`greedy`), and how
  much an idle bot does (`idle`). 1.00 is fair. Good: greedy well above 1, idle well below 1.
- **Option sensitivity** (with `--sweep options`): mean duration with one option moved, and the change from the
  default. Large changes show which options matter; options that change nothing may be pointless.

A round that ends with every player tied for first counts as a draw, not as a win for anybody.

### Flags

The `FLAGS` list at the end of the report says what to look at:

| Flag | Meaning |
|---|---|
| `N% of rounds never finished (stuck)` | The round hit the time limit plus 10 s without ending. |
| `rounds are very short` | Mean round length under 10 s. |
| `spawn slot bias: ...` | A slot's win share is far from fair (a z-score above 3 against 1/N). |
| `skill gap: the greedy bot is not clearly better than random` | With 20 or more rounds. Often the bot, not the game. |
| `an idle player wins ... its fair share` | With 20 or more rounds. Standing still is competitive; random bots may be killing themselves in a game that rewards survival, so check with `greedy` too. |

## Output columns

Each line of the `--out` file is one player in one round:

| Column | Meaning |
|---|---|
| `variant`, `options` | The variant id and the options that differ from its defaults (`{}` = defaults). |
| `playerCount`, `seed` | Players in the round and the seed. |
| `scenario`, `policy`, `slot` | The line-up, this player's bot and its spawn slot (0-based). |
| `place`, `firstPlaces` | Final place (ties share one) and how many players share first. |
| `durationSec`, `limitSec` | Round length and the time limit, in seconds. |
| `timedOut` | The round never finished (a bug). |
| `metric` | The player's score, health or lap progress at the end, when the game has one. |

## Applying what you find

1. Change the option in the host panel to try it live, or set it as the default for everybody with
   `games.defaults` in your config or `npm run admin defaults set` (see [../admin-api.md](../admin-api.md)).
2. Run the sweep again with the same flags and compare.
3. If you changed a default in a game's `game.json`, run `npm run config:example`, update the options table
   in the README and the matching page in [../manual/games.md](../manual/games.md).

## Limits

- The simulator plays the game rules directly. It does not include the countdown, scoring across rounds
  (points, rounds to win) or the network, so it says nothing about the lobby and match flow.
- The bots do not play like people. Use the numbers to find suspicious variants and compare option values, and
  confirm by playing.
- The tool plays every game under `src/games/`. A game that ships a `bot` on its server plugin gets it for the
  `greedy` and `skill` scenarios; the others fall back to a generic chase-the-nearest bot.
