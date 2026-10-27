# Rumble Cards: notes for agents

Read the root `AGENTS.md` first (rules 6 and 7 cover game AIs). This file covers what is specific to this pack. `README.md` next to it covers building and validating the pack.

## The game

A turn-based card duel for 2 to 4 players. Each seat gets a hero (dealt at random) with a 28-card deck (`shared/cards.ts`: `CARDS`, `HEROES`).

- **Setup:** everyone starts with `hp` (10, also the maximum) and `hand` (3) cards.
- **A turn:** nothing is drawn at the start; play at least one card from the hand (it was refilled when your last turn ended). Each play costs one of the plays left (`left`); a card with `play +N` gives more.
- **Turn end:** when no plays are left or the hand is empty; **B** ends it early after one play. When the turn timer (`turnSeconds`) runs out with nothing played, the server plays a card (`autoPlay`).
- **Hand limit** (`maxHand`, 3) is also the hand size at the end of every turn: a hand above it must be discarded first, and a hand below it is **drawn up to it** when the turn passes (`finishTurn`; the deck is refilled from the discard pile as usual, and a hand emptied by plays is refilled completely). `draw` cards still draw during the turn and may take the hand over the limit, which is then discarded. The turn does not pass: the snapshot's `purge` says how many cards are left to throw away, the player picks them (`a1` / `{ a: 'discard', c }` on the selected card; plays, `a2` and End turn are ignored meanwhile), the cards go to the discard pile and the turn passes at the limit. The discard step shares the turn timer (nothing is added); when it runs out, random cards are discarded down to the limit (`ext:discard` with `auto: true`). The starting `hand` is dealt as is and not clamped by the limit; the first player does not draw before their first turn.
- **Damage:** hits Defense cards first (oldest first, at most 5 on the table), then hit points. 0 hit points is out.
- **Round end:** one player left, or `maxTurns` turns each. Survivors rank by hit points, the rest by how long they lasted.
- **Card effects:** `dmg` (one target), `all` (every opponent, **teammates too**), `heal`, `draw`, `play`, `steal` (a random card from the target's hand), `smash` (destroys the target's oldest Defense). Defense cards stay until used up.
- **Teams:** `teams: true`, max 2 per team. Teammates are opponents to the rules.

**Input** (`handleInput` in `server/RumbleCards.ts`). Only presses count (a change from the centre), and only on your own turn:

| control | effect |
|---|---|
| stick x ±1 | move the selected card `cur` (wraps around) |
| stick y ±1 | move the aimed rival `aim` through the other players still in, in seat order |
| `a1` | play the selected card at the aim (while `purge > 0`: discard the selected card) |
| `a2` | end the turn (after at least one play; ignored while `purge > 0`) |

Phones use `GAME_ACTION` (`handleAction`: `sel`, `aim`, `play`, `end`, `discard`). Bots cannot, so they use the controls above.

**Host options:** `hp`, `hand`, `maxHand`, `turnSeconds`, `maxTurns`. There are no variants. `turnVariance` (+- s, drawn fresh each turn; the bot's `tt` rules read the snapshot, so they follow it).

## Integration with the core

- **Server entry** (`server/index.ts`): `createMinigame` builds `RumbleCards(applyOptions(options), rng)`. `bot` is `server/bot.ts` (presses A each turn, for `npm run balance`). `ai` is the bot.
- **Snapshot** (kind `ext:rumble-cards`): players (hero, hp, counts of hand, deck and discard, Defense as `[card, hp left]`, out), `turn`, `made`, `left`, `tt` (turn seconds left) and `ttMax` (the length this turn was given, variance included), `purge` (cards left to discard), `aim`, `last` play.
- **Private state** (`getPrivateState`): `{ hand, cur }`. It is sent to its owner when it changes. The bots plugin's brain hands it to `onPrivate` (also when it arrives before the first snapshot), and `bot/offline.ts` and `core/shared/kit/botsim.ts` do the same.
- **Events:** `ext:play` (cast: card, target), `hit`, `heal`, `ext:block` (these three also carry `n` and the player's `hp` and `sh` afterwards), `ext:guard`, `ext:break`, `ext:discard` (card `c`, `auto` when taken at random), `ext:tick` (`n` = whole seconds left, 5 to 1, only when the turn is longer than 5 s), `eliminated`.
- **Effects of a cast** (`client/Board.ts`): every card with direct damage sends a big comet (glow, a faint line along its path, a trail) from the caster to each affected rival over ~0.6 s, ending in a flash, two shockwave rings and sparks (950 ms in all); the hit numbers (40 px), sounds and screen shake wait for its arrival (`impactDelay`, 610 ms, also for Hex and Shatter): the aimed one (`dmg`), or every rival still in (`all`, with a burst round the caster). Cards that also steal or smash (Hex, Shatter) show their own effect and the damage comet. With reduced motion (`calm()`, the system's prefers-reduced-motion) nothing travels: the damage shows as a still line to each target and a flash on it that only fade (`drawStillHit`); the other flights (heal, Defense, draw, steal, smash) are not drawn then. `client/Board.test.ts` replays the renderer against a fake graphics object for both modes.
  A player's screen has no table (only the hand and the players strip), so `client/comets.ts` flies a DOM comet over the strip from the caster's panel to each target's panel (600 ms, then a ring and flash; a still line and flash with reduced motion). Only a player's controls register the sink (`setCometSink` in `Controller.ts`), so the table never gets both. Targets come from `targetsOf` (aimed rival, or every rival still in for `all`).
- **History** (`client/history.ts`, `HistoryView.ts`): built on each client from the events, newest last: `ext:play` starts an entry, the `hit` / `ext:block` / `heal` / `ext:break` / `ext:guard` / `eliminated` that follow in the same batch fill its per-player changes, `ext:discard` is an entry of its own. `hit`, `ext:block` and `heal` carry `hp` and `sh` (hit points and total Defense after the change) for the balance. It shows on the table (`.rco-log`, last 6, hidden on narrow screens) and on the phone (**History** button). It is reset with the renderer at the start of a round, so a client that reconnects mid-round starts with an empty one.
- **Last seconds of a turn:** the `ext:tick` event makes every client tick (`tickSound`, rising pitch, a double at 1), flash the panel of the player on turn and buzz their phone; the ring round them goes green, amber (`timerTone`: the last 10 s, or the second half of a short turn) and a throbbing red in the last 5 s, and the phone's timer text turns amber then blinking red. The ring is `tt / ttMax` (it used to be `tt / 60`). Reduced motion keeps the sound and the colour but no throbbing, flash or shake.
- **Client:** a DOM overlay and controller (`client/Board.ts`, `Controller.ts`, `CardView.ts`, `art.ts` for the inline SVG card art, `sounds.ts`). Catalog texts are in `game.json` with `locales`.
- **Character:** players are drawn with `ctx.drawCharacter`, using the `blob` model of the `characters` plugin (`"character": "blob"` in `game.json`); the game is skipped when that plugin is not loaded. Looks never reach the snapshot, so the bot is unaffected.

## The bot (`bot/`)

Over the hand limit (`purge > 0`) the policy discards instead: the card worth least to play (the planner's own `value`, a random card on a `mistake`; `greedy` takes the first). The driver selects it (`cur` stepping) and presses A; the `end` want also counts as done once a purge starts. The policy picks **what** to play; the driver in `index.ts` works the controls to make it happen.

**Perception** (`world.ts`):
- the hand and selection from `onPrivate`;
- `others`: everyone the aim cycles through (seat order, teammates included);
- `foes`: others minus `allies`;
- `DMG_PER_CARD` per hero (the threat a rival's hand holds);
- `guard` = hit points + Defense.

**Policy `planner`** (`policy/planner.ts`) scores every (card, target):
- **Extra-play cards** first: they cost no play (`extraFirst`).
- **Damage:** at 2.2 per point, +8 for a knock-out; focus on the weakest or the leader (`focusLeader`); −10 on a teammate.
- **`all`:** counts the foes hit, minus teammates hit.
- **Heals and Defense:** valued like hit points kept (2.2 per point), plus the threat expected before its next turn, scaled by `defense`. A heal at full health is a cost, so after a play it **ends the turn** instead.
- **`smash`** on Defense, **`steal`** from a non-empty hand.
- **`mistake`:** the share of plays that are a random legal card and target.
- **`lookahead` 0:** the server's own timeout scoring.

**Driver** (`index.ts`):
1. Thinks `thinkMs` (randomised ×0.6 to 1.4) before each play, and hurries when the turn timer is under 2.5 s.
2. Steps the selection (mx ±1, shortest way round), then the aim (my ±1, shortest way), then presses A. Every press is followed by a release.
3. Waits until the private `cur`, the public `aim` or `made`/hand size show the step happened (450 ms timeout) before the next one.

**Policy `greedy`:** plays the first card at the current aim, like `server/bot.ts`.

**Levels** (`levels.ts`): `thinkMs`, `mistake`, `lookahead`, `focusLeader`, `defense`, `lapse`.

Incident causes (`incidents.ts`) and their knobs:

| cause | meaning | knobs |
|---|---|---|
| `knocked-out` | out of the round | `defense`, `focusLeader`, `mistake`; card values in `policy/planner.ts` |
| `turn-timeout` | the timer ran out before it played (the server picked) | `thinkMs`, the driver's confirm timeout; it should never happen |

**Commands:**
- Tests: `npx vitest run src/games/rumble-cards`.
- A/B: `bot/sim.ts` (`heroes` option fixes the deal).
- Ladder: `bot/scenarios/ladder-rumble-cards.json`.

## Considerations

- **Luck:** the deal decides much of a round. In 2-player duels semigod beats a player of random cards (`mistake: 1`) in about 70% of rounds, and beats the server's timeout scoring only narrowly (53–45 over 100). So the level ladder leans on `mistake` and needs many rounds (60+) per comparison.
- **Calibration** (2026-10): in 100-round duels semigod beats easy 72–28, adjacent levels only 52–55%; the 4-seat ladder reads about 50%. That is the game's luck, not the levels: do not chase a 65% ladder here.
- **Measured** (100-round A/B): valuing Defense against one turn's threat lost to the timeout scoring (43–55); valuing it by its hit points (Defense lasts many turns) fixed that.
- **Ties:** before random tie-breaking every bot aimed at the first rival in seat order, so seat 0 was ganged up on. Keep the tie jitter in `policy/planner.ts`.
- **Input:** both stick axes must reach the server, and presses need a release in between, which the driver does. The game reads inputs as they arrive, not per tick.

## When the game rules change

| server code | bot code that depends on it |
|---|---|
| controls (`handleInput`: press edges, card cycling, aim order) | the driver in `bot/index.ts` (`step`, `done`), rules-contract test |
| turn rules (`left`, `made`, auto end, timer, `autoPlay`, hand limit and `purge`) | `index.ts` (hurry, turn tracking, the `discard` plan/want), `policy/planner.ts` (end-turn rule, `discard`), `policy/greedy.ts` |
| cards and heroes (`shared/cards.ts`) | `policy/planner.ts` `value` (every effect kind), `world.ts` `DMG_PER_CARD` |
| damage and Defense rules (`MAX_DEFENSE`, oldest first) | `policy/planner.ts` (`guard`, Defense value, `MAX_DEFENSE`) |
| private state shape (`getPrivateState`) | `world.ts` `setPrivate` |

Checklist:
1. Decide whether the change affects what the bot perceives, predicts or chooses. If it does not, say so in the change.
2. Update the files mapped above. **A new effect kind must get a value in `policy/planner.ts`**, or the bot ignores it.
3. Variants added later: give them adapters and ladders, following Frost Shove.
4. Input changes: the driver and the rules-contract test (presses move the card and the aim, and A plays).
5. Run the tests and `gamepack validate`.
6. Run an offline ladder (many rounds) and `/bot-tune`.
7. Update this file.

## Optional core hooks

`getStats()` reports each seat's remaining `hp` with the round result. It reads existing state only, so the bot needs no change. The game does not implement `addPlayer`: a knock-out is final, so a returning player sits the round out.

## Bot sync (2026-10-26)
- `MAX_DEFENSE` is exported by `server/RumbleCards.ts` and imported by the planner. No rule change affects the bot.
