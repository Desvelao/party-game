# Games

There are eight games, most with several variants. In a room the host picks one variant, rotates through all of
them, mixes games or builds a [playlist](hosts.md). The in-game **Game guide** repeats the rules.

Most games use the same two controls: move, plus one action button whose name depends on the game. Rumble Cards is the exception: you play cards from your phone (see below).

| Game | Variants | Players | Goal |
|---|---|---|---|
| Crazy Logs | Crazy Logs | any | Cross the river on spinning logs as many times as you can before the time runs out. Most crossings wins. Action: ACT |
| Ballistix | Smashball, Sand Orb, Pulse Ball, Cloud Orbs | up to 4 | Slide your paddle along your side and keep the balls out of your goal. Action: BOOST (Sand Orb: GRAB, then BOOST) |
| Frost Shove | Frost Classic, Frost Frenzy, Tip Tumble, Thaw Frenzy, Wild Frenzy | any | Ride a polar bear on an ice floe and charge rivals into the water. Last bear on the ice wins. Action: CHARGE |
| Spring Showdown | Spring Painter, Spring Rush, Spring Madness, Spring Lock | any | Hop across the grid painting tiles your colour and bank them for points. Action: FIRE |
| Box Bonanza | Jungle Bonanza, Space Bonanza, Snow Bonanza, Drain Bonanza | any | Pick up and throw crates at your rivals, kick with the other button. Last one standing, or the most health, wins. Action: GRAB (second action: KICK) |
| Sprint Smash | Dot Sprint, Toxic Sprint, Ember Sprint, Splash Sprint | any | Race hovercrafts around a circular track. Hold to boost, shove rivals and finish the laps first. Action: DASH (second action in Dot Sprint: FIRE; in Toxic Sprint: CHARGE; in Ember Sprint: FIRE; in Splash Sprint: JUMP) |
| Tank Wars | Desert Fox, Metal Fox, Jungle Fox, Swamp Fox | any | Drive a tank, shoot rivals and plant mines. Last tank standing, or the most health, wins. Action: FIRE (second action: MINE) |
| Rumble Cards | Rumble Cards | up to 4 | Duel with your hero's deck of cards: hit rivals, block and heal. Last hero standing wins. Played with cards on your phone |

The maximum number of players of a room also depends on the server's profile (see
[Performance profiles](performance-profiles.md)); the room cannot start a game that supports fewer players than
are in the lobby.

## Variants in one line

- **Ballistix**: *Smashball* is the classic where the ball speeds up with every hit; *Sand Orb* (amber board) has floaty balls
  you grab and launch; *Pulse Ball* (light blue board) adds a ball-bot that fires balls; *Cloud Orbs* (light gray board) is played on an aircraft whose
  engines fail and drag the balls. The platform floats in the air, and when an engine fails the corner above it drops
  while the engine stays in place. If you set **Screen shake and motion** to **Off**, the platform stops rocking and the clouds stop drifting.
- **Frost Shove**: ride a polar bear on an ice floe. *Frost Classic* is the classic with a stamina bar; its power-up beam gives only grow, shrink, Lightning or Weight; *Frost Frenzy* sweeps energy bolts
  across the ice; *Tip Tumble* tilts the floe towards the crowd (and now and then a fish jumps onto the ice and a walrus climbs up to catch it, tipping the floe with its weight; the **Walrus interval** and **Walrus variance** settings control how often); *Thaw Frenzy* has Gruff flying to the edge to melt a bite out of it now and then (he hovers there and a glowing crack warns you first; the **Melt interval**, **Melt variance** and **Melt depth** settings control it); *Manic
  Panic* adds throwable bombs.
  In every variant, if you slip off the edge gently you hang on the rim and can mash the button to climb back onto the ice;
  a hard push sends you into the water for good. While you hang there the bear sinks lower the less time you have
  left, so keep mashing. *Frost Classic* also has a wall of ice slices around the edge: it blocks
  you, and a dash into it breaks a slice and opens a gap.
  In every variant a robot (Gruff in *Thaw Frenzy*) floats around the floe and now and then lights a beam on the ice: walk into it to get a random power-up (**Power-up interval** sets how often). In *Thaw Frenzy* the beam only gives bad ones. The beam can give **Lightning** or **Weight** (in the other variants, mixed with the usual power-ups). Touch another bear to pass it on. After 10 seconds Lightning stuns every
  other bear for 6 seconds, so hold on to it; Weight knocks out the bear holding it, so hand it over fast. A ring over the
  holder shows the time left. Falling into the water makes you lose it.
- **Spring Showdown**: *Spring Painter* needs a crate to bank tiles; *Spring Rush* scores by enclosing areas (a loop must be closed with your own squares, side by side, inside the board; the edge of the board does not count);
  *Spring Madness* does both, and Blast Bot lays TNT that counts down (3 seconds by default) and then explodes,
  stunning players and wiping the squares around it (stay out of the red zone; the hosts can change the fuse and
  blast size with **TNT fuse** and **TNT blast radius**); *Spring Lock* lets missiles steal squares. In *Spring Rush* the Zap Beam item fires a lightning bolt in the direction you are facing and stuns every rival in that row or column ahead of you, however far away; rivals behind you or off the line are safe. Missiles have their own sounds (a whoosh when fired, a deeper one when Blast Bot fires, a thud on a hit) that follow the **Effects** volume. Speed boots make a quick chirp while they last, faster in the last second and a half, and a soft power-down when they wear off.
- **Box Bonanza**: *Jungle Bonanza* has blocks, TNT and nitro; *Space Bonanza* blows holes in the floor; *Snow Bonanza* has
  ice and a sleeping penguin; *Drain Bonanza* has locked and surprise crates.
- **Sprint Smash**: *Dot Sprint* is a circuit with an open edge: the track is the top of a skyscraper. The inner edge is always a wall, and of the outer edge only the top (from 10 to 2 o'clock) is, so anywhere else on the outside you can fall into the void, lose a few seconds (the host can change **Fall penalty**) and be put back where you fell. You have no passive speed-up: each berry loads your bar and you hold the action button to burn it for speed. Missiles use their own button (FIRE), fly straight ahead and bounce off the top wall and the inner wall; a craft that is hit is stunned and then crawls for a few seconds (the host can change **Hit slowdown**). *Toxic Sprint* has the berry bar and an open outer edge too (fall into the toxic liquid and lose time like in Dot Sprint, but there is no wall on the outside at all; the host can change **Fall penalty**), and adds rusty toxic barrels at random places on the track, a slime monster and a force field you pick up and use with the second button (CHARGE) to push nearby rivals away, all over a pool of toxic green liquid; a small icon above a craft shows that it holds a missile or a force field; *Ember Sprint* has the same berry bar, missile button (FIRE) and open edge, but you fall into liquid lava; the volcano in the middle throws balls of lava across the track, and one that hits you knocks you away, stuns you and leaves you crawling for a few seconds (the host can change **Hit slowdown** and **Eruption interval**); *Splash Sprint* is a circuit over the sea with the same berry bar and open edge (you fall into the water; the host can change **Fall penalty** and **Hit slowdown**): the hub in the middle has six ports, and now and then tubes leave them across the track, either all six or just one, sometimes in quick sequences. The hub turns against the direction of the lap. A tube knocks you away and slows you; press the second button (JUMP) to jump over it. The host can change **Tube interval**, **Tube variance**, **Tube bursts** (the chance of quick sequences) and **Hub speed**.
  Items (berries, missiles and force fields) appear often; the host can change how often and, with **Max berries**, **Max missiles** and **Max force fields**, how many can be waiting on the track at once.
- **Tank Wars**: *Desert Fox* is a block maze; *Metal Fox* has walls that rise and fall; *Jungle Fox* is an open
  arena with falling hazards (8 squares wide by default; the host can change **Arena size** from 6 to 11 squares, in *Swamp Fox* too); *Swamp Fox* has shielded boats and mines that drift slowly in a random direction and blow up when anyone touches them (the host can change **Mine speed**). In *Swamp Fox* and *Jungle Fox* your cannon shots bounce off walls and the edge of the field (turn **Bouncing shots** off, or change **Shot duration**, in **Advanced options**); a shot never hurts the one who fired it.

## Playing Rumble Cards

Rumble Cards is a turn-based card duel for 2 to 4 players. Each player gets one of four heroes (Volt Fox, Iron Mole,
Hex Owl or Comet Cat) with their own deck. The shared screen shows everyone's hit points, their Defense cards as
small cards, and the last card played, large in the middle for a moment. Your own hand is only on your phone.

1. Wait for your turn. At the top of your phone you see **Your turn**, the seconds left and **Plays left**.
2. Look at your hand. Every card has its name on top, an illustration, and a text box with icons that show what it
   does: a sword is damage, a heart recovers hit points, two cards draw cards, an arrow lets you play more cards and a
   shield is **Defense**. Cards with a special effect (**Steal**, **Smash**) also say it in words. Swipe sideways if
   your hand does not fit, then tap a card to select it; it lifts up.
3. If the card hits a rival and several are still in, tap the rival you want to hit.
4. Play the card in any of these ways. You must play at least 1 card each turn; nothing is drawn when your turn starts.
   Some cards let you play more.
   - Tap the selected card again.
   - Drag the card up onto the table and let go: the card follows your finger or mouse and is thrown at the rival
     with the red ring. To choose another rival, drag the card onto that rival's name at the top of the screen
     instead: that rival becomes the new target, and a tag on the card (**➜** and the name) and the red ring on
     their panel show who will be hit before you let go. Let go over your hand to put the card back, and the target goes
     back to what it was. A sideways drag scrolls your hand.
   - Use the on-screen buttons: left and right pick a card, up and down pick the rival, then press **Play**.
     On a keyboard use the arrow keys and the action key.
5. When you are done, tap **End turn** (or press the second action button). If the time runs out, a card is played
   for you if you had not played one.

Heroes face the middle of the table, and the player whose turn it is turns to face the rival being aimed at. Hits fly across the table, with the damage or healing shown over the player's name, and hit point bars that drain smoothly. Each kind of card has its own sound (a crackle for lightning, a thud for rocks, a chime for healing, a clang for a blocked hit), and hits sound heavier the more damage they do; they follow the sound volume setting. Defense cards stay on the table and take damage before your hit points do; once used up they are discarded. You are
out at 0 hit points and the last hero standing wins the round. If nobody wins by the turn limit, the most hit points
wins. In team rooms, points are summed per team,
but you can still hit your teammates, so choose your targets.

The host can change **Hit points**, **Starting hand**, **Hand limit**, **Turn time** and **Turn limit** in **Advanced options**.

When your turn ends your hand is refilled up to the **Hand limit** (3 cards by default), so you start every turn with a full hand. If you hold more than the limit instead, you must discard the extra ones before the turn passes: tap a card to select it, then press **Discard** (or tap it again). The time to do it comes out of your turn time; if the time runs out, random cards are discarded for you, with a stronger crunch and flash. Every card that deals damage sends a flash from the player who played it to each rival it hits. If your device is set to reduce motion, the flash does not travel: you see a still line to the target and a flash on it that fades. The table shows a list of the last plays in the bottom corner, and on your phone the **History** button shows them too: who played which card, against whom, and what changed for each player (hit points ♥ and Defense 🛡, with the new total in brackets). The last 5 seconds of every turn tick, the player's ring on the table turns red and your timer on the phone blinks.

## Options

Each game and variant has options such as time limit, health or how often crates appear. The host changes them in
**Advanced options** when creating a room or choosing **Change game**. During a round, the time left is shown in seconds at the top of the screen. Operators can change the defaults, see
[Administration](administration.md).
